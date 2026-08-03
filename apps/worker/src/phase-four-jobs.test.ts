import 'dotenv/config';

import { createDatabaseClient, type PrismaClient } from '@wasel/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { completeDeliveredOrders } from './phase-four-jobs.js';

describe.sequential('Phase 4 completion worker integration', () => {
  let database: PrismaClient;
  let disputedCommissionCountBefore: number;
  const pastOrderId = '93000000-0000-4000-8000-000000000003';
  const disputedOrderId = '93000000-0000-4000-8000-000000000004';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for worker integration tests.');
    }
    database = createDatabaseClient(process.env.DATABASE_URL);

    // This suite may run after API E2E scenarios that resolve the seeded
    // dispute. Arrange the worker fixture explicitly so the assertion does
    // not depend on the order in which Vitest executes database suites. Any
    // historical ledger lines remain immutable; the test asserts that the
    // worker does not append another one.
    await database.$transaction([
      database.deliveryDispute.update({
        where: { orderId: disputedOrderId },
        data: {
          status: 'COURIER_RESPONDED',
          resolutionNote: null,
          resolvedById: null,
          resolvedAt: null,
        },
      }),
      database.deliveryOrder.update({
        where: { id: disputedOrderId },
        data: {
          status: 'DELIVERY_DISPUTED',
          financialFinalizedAt: null,
          completedAt: null,
          completionSource: null,
        },
      }),
    ]);
    disputedCommissionCountBefore = await database.courierLedgerEntry.count({
      where: { orderId: disputedOrderId, type: 'COMMISSION_DUE' },
    });
  });

  afterAll(async () => database?.$disconnect());

  it('finalizes an overdue undisputed delivery once under duplicate execution', async () => {
    const now = new Date('2026-07-27T20:00:00.000Z');
    await Promise.all([
      completeDeliveredOrders(database, now),
      completeDeliveredOrders(database, now),
    ]);
    const order = await database.deliveryOrder.findUniqueOrThrow({
      where: { id: pastOrderId },
    });
    expect(order.status).toBe('COMPLETED');
    expect(order.completionSource).toBe('DISPUTE_WINDOW_EXPIRED');
    expect(
      await database.courierLedgerEntry.count({
        where: { orderId: pastOrderId, type: 'COMMISSION_DUE' },
      }),
    ).toBe(1);
  });

  it('does not finalize or create commission for a disputed delivery', async () => {
    await completeDeliveredOrders(
      database,
      new Date('2026-07-27T20:00:00.000Z'),
    );
    expect(
      await database.deliveryOrder.findUniqueOrThrow({
        where: { id: disputedOrderId },
        select: { status: true },
      }),
    ).toEqual({ status: 'DELIVERY_DISPUTED' });
    expect(
      await database.courierLedgerEntry.count({
        where: { orderId: disputedOrderId, type: 'COMMISSION_DUE' },
      }),
    ).toBe(disputedCommissionCountBefore);
  });
});
