import 'dotenv/config';

import { createDatabaseClient, type PrismaClient } from '@wasel/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe.sequential('Phase 3 database integrity boundaries', () => {
  let database: PrismaClient;
  let courierId: string;
  let adminId: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for database tests.');
    }
    database = createDatabaseClient(process.env.DATABASE_URL);
    courierId = (
      await database.courierProfile.findFirstOrThrow({
        where: { verificationStatus: 'APPROVED' },
        orderBy: { createdAt: 'asc' },
      })
    ).id;
    adminId = (
      await database.user.findFirstOrThrow({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      })
    ).id;
  });

  afterAll(async () => {
    await database?.$disconnect();
  });

  it('enforces one commission entry and one settlement line per completed order', async () => {
    const original = await database.courierLedgerEntry.findFirstOrThrow({
      where: {
        type: 'COMMISSION_DUE',
        orderId: { not: null },
        settlementLine: { isNot: null },
      },
      include: { settlementLine: true },
    });
    await expect(
      database.courierLedgerEntry.create({
        data: {
          courierId: original.courierId,
          orderId: original.orderId,
          type: 'COMMISSION_DUE',
          amountMinor: original.amountMinor,
          sourceKey: `integration-duplicate-order-${runId}`,
          reason: 'This duplicate commission must be rejected.',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.settlementLine.create({
        data: {
          settlementPeriodId: original.settlementLine!.settlementPeriodId,
          ledgerEntryId: original.id,
          amountMinor: original.amountMinor,
        },
      }),
    ).rejects.toThrow();
  });

  it('makes ledger and payment source records immutable', async () => {
    const entry = await database.courierLedgerEntry.findFirstOrThrow();
    await expect(
      database.courierLedgerEntry.update({
        where: { id: entry.id },
        data: { reason: 'Attempted destructive history edit.' },
      }),
    ).rejects.toThrow(/immutable/i);

    const payment = await database.externalPaymentRecord.findFirstOrThrow();
    await expect(
      database.externalPaymentRecord.update({
        where: { id: payment.id },
        data: { note: 'Attempted destructive payment edit.' },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it('enforces payment idempotency and one reversal link', async () => {
    const original = await database.externalPaymentRecord.create({
      data: {
        courierId,
        amountMinor: 100,
        paidAt: new Date(),
        method: 'OTHER',
        createdById: adminId,
        idempotencyKey: `db-original-${runId}`,
      },
    });
    await expect(
      database.externalPaymentRecord.create({
        data: {
          courierId,
          amountMinor: 100,
          paidAt: new Date(),
          method: 'OTHER',
          createdById: adminId,
          idempotencyKey: original.idempotencyKey,
        },
      }),
    ).rejects.toThrow();

    await database.externalPaymentRecord.create({
      data: {
        courierId,
        amountMinor: 100,
        paidAt: new Date(),
        method: 'OTHER',
        createdById: adminId,
        idempotencyKey: `db-reversal-one-${runId}`,
        reversesPaymentId: original.id,
      },
    });
    await expect(
      database.externalPaymentRecord.create({
        data: {
          courierId,
          amountMinor: 100,
          paidAt: new Date(),
          method: 'OTHER',
          createdById: adminId,
          idempotencyKey: `db-reversal-two-${runId}`,
          reversesPaymentId: original.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rolls back the whole transaction when a settlement constraint fails', async () => {
    const sourceKey = `rollback-ledger-${runId}`;
    await expect(
      database.$transaction(async (transaction) => {
        await transaction.courierLedgerEntry.create({
          data: {
            courierId,
            type: 'ADJUSTMENT_DEBIT',
            amountMinor: 50,
            sourceKey,
            reason: 'Must roll back with the invalid settlement.',
            occurredAt: new Date(),
          },
        });
        const boundary = new Date();
        await transaction.settlementPeriod.create({
          data: {
            courierId,
            periodStart: boundary,
            periodEnd: boundary,
            dueAt: boundary,
          },
        });
      }),
    ).rejects.toThrow();
    expect(
      await database.courierLedgerEntry.count({ where: { sourceKey } }),
    ).toBe(0);
  });

  it('rejects non-EGP records and invalid settlement dates', async () => {
    await expect(
      database.courierLedgerEntry.create({
        data: {
          courierId,
          type: 'ADJUSTMENT_DEBIT',
          amountMinor: 50,
          currency: 'USD',
          sourceKey: `invalid-currency-${runId}`,
          reason: 'Non-EGP entry must be rejected.',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.settlementPeriod.create({
        data: {
          courierId,
          periodStart: new Date('2026-09-14T00:00:00.000Z'),
          periodEnd: new Date('2026-09-13T00:00:00.000Z'),
          dueAt: new Date('2026-09-12T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });
});
