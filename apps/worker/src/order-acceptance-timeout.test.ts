import 'dotenv/config';

import { createDatabaseClient, type PrismaClient } from '@wasel/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expireCourierAcceptanceWindows } from './order-acceptance-timeout.js';

describe.sequential('courier acceptance timeout worker integration', () => {
  let database: PrismaClient;
  const orderId = '87000000-0000-4000-8000-000000000001';
  const now = new Date('2026-08-02T12:00:00.000Z');

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for worker integration tests.');
    }
    database = createDatabaseClient(process.env.DATABASE_URL);
  });

  afterAll(async () => {
    if (database) {
      await database.deliveryOrder.update({
        where: { id: orderId },
        data: {
          status: 'SEARCHING_COURIER',
          courierId: null,
          dispatchAttemptCount: 1,
          acceptanceExpiresAt: new Date(Date.now() + 5 * 60 * 1_000),
          version: { increment: 1 },
        },
      });
      await database.$disconnect();
    }
  });

  it('expires the first attempt once under duplicate worker execution', async () => {
    const before = await database.orderEvent.count({
      where: { orderId, eventType: 'COURIER_SEARCH_EXPIRED' },
    });
    await database.deliveryOrder.update({
      where: { id: orderId },
      data: {
        status: 'SEARCHING_COURIER',
        courierId: null,
        dispatchAttemptCount: 1,
        acceptanceExpiresAt: new Date(now.getTime() - 1),
        version: { increment: 1 },
      },
    });

    const results = await Promise.all([
      expireCourierAcceptanceWindows(database, now),
      expireCourierAcceptanceWindows(database, now),
    ]);
    expect(results[0] + results[1]).toBeGreaterThanOrEqual(1);
    expect(
      await database.deliveryOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          status: true,
          acceptanceExpiresAt: true,
          dispatchAttemptCount: true,
        },
      }),
    ).toEqual({
      status: 'NO_COURIER_AVAILABLE',
      acceptanceExpiresAt: null,
      dispatchAttemptCount: 1,
    });
    expect(
      await database.orderEvent.count({
        where: { orderId, eventType: 'COURIER_SEARCH_EXPIRED' },
      }),
    ).toBe(before + 1);
    expect(
      await database.courierLedgerEntry.count({ where: { orderId } }),
    ).toBe(0);
    expect(
      await database.notification.count({
        where: {
          relatedEntityId: orderId,
          type: 'COURIER_SEARCH_TIMEOUT',
        },
      }),
    ).toBe(2);
  });

  it('expires the second attempt into the final state without a third retry', async () => {
    await database.deliveryOrder.update({
      where: { id: orderId },
      data: {
        status: 'SEARCHING_COURIER',
        courierId: null,
        dispatchAttemptCount: 2,
        acceptanceExpiresAt: new Date(now.getTime() - 1),
        version: { increment: 1 },
      },
    });

    expect(await expireCourierAcceptanceWindows(database, now)).toBe(1);
    expect(
      await database.deliveryOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, dispatchAttemptCount: true },
      }),
    ).toEqual({
      status: 'NO_COURIER_AVAILABLE_FINAL',
      dispatchAttemptCount: 2,
    });
  });
});
