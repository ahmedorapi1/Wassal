import { describe, expect, it } from 'vitest';

import {
  allocateOldestSettlements,
  daysRemaining,
  roundBasisPoints,
  settlementProjection,
  settlementStatus,
  weeklySettlementBounds,
} from './finance-domain.js';

describe('Phase 3 courier accounting domain', () => {
  it('calculates the fixed 20% product example without floating-point money', () => {
    expect(roundBasisPoints(10_000, 2_000)).toBe(2_000);
    expect(10_000 - roundBasisPoints(10_000, 2_000)).toBe(8_000);
    expect(roundBasisPoints(3_751, 1_500)).toBe(563);
  });

  it('uses Cairo Monday boundaries across the Egypt DST season', () => {
    const bounds = weeklySettlementBounds(
      new Date('2026-07-29T12:00:00.000Z'),
      7,
    );
    expect(bounds.periodStart.toISOString()).toBe('2026-07-26T21:00:00.000Z');
    expect(bounds.periodEnd.toISOString()).toBe('2026-08-02T21:00:00.000Z');
    expect(bounds.dueAt.toISOString()).toBe('2026-08-09T21:00:00.000Z');
  });

  it('derives ledger projections using the courier-liability sign convention', () => {
    expect(
      settlementProjection(
        [
          { type: 'COMMISSION_DUE', amountMinor: 2_000 },
          { type: 'ADJUSTMENT_DEBIT', amountMinor: 300 },
          { type: 'ADJUSTMENT_CREDIT', amountMinor: -100 },
          { type: 'WAIVER', amountMinor: -200 },
        ],
        1_500,
      ),
    ).toEqual({
      totalCommissionDueMinor: 2_000,
      totalPaymentsMinor: 1_500,
      totalAdjustmentsMinor: 200,
      totalWaivedMinor: 200,
      remainingAmountMinor: 500,
    });
  });

  it('keeps waiver, adjustment, and reversal entries compensating and append-only', () => {
    expect(
      settlementProjection(
        [
          { type: 'COMMISSION_DUE', amountMinor: 2_000 },
          { type: 'ADJUSTMENT_DEBIT', amountMinor: 500 },
          { type: 'WAIVER', amountMinor: -300 },
          { type: 'REVERSAL', amountMinor: -500 },
        ],
        0,
      ),
    ).toEqual({
      totalCommissionDueMinor: 2_000,
      totalPaymentsMinor: 0,
      totalAdjustmentsMinor: 0,
      totalWaivedMinor: 300,
      remainingAmountMinor: 1_700,
    });
  });

  it('allocates a partial payment to oldest settlements and rejects overpayment', () => {
    const settlements = [
      {
        id: 'new',
        periodStart: new Date('2026-07-20'),
        remainingAmountMinor: 900,
      },
      {
        id: 'old',
        periodStart: new Date('2026-07-13'),
        remainingAmountMinor: 600,
      },
    ];
    expect(allocateOldestSettlements(1_000, settlements)).toEqual([
      { settlementPeriodId: 'old', amountMinor: 600 },
      { settlementPeriodId: 'new', amountMinor: 400 },
    ]);
    expect(() => allocateOldestSettlements(1_501, settlements)).toThrow(
      'overpayment',
    );
  });

  it('derives partial, paid, overdue, waived, and due-soon states', () => {
    const dueAt = new Date('2026-08-10T00:00:00.000Z');
    const common = {
      open: false,
      totalAdjustmentsMinor: 0,
      totalWaivedMinor: 0,
      dueAt,
    };
    expect(
      settlementStatus({
        ...common,
        remainingAmountMinor: 500,
        totalPaymentsMinor: 200,
        now: new Date('2026-08-01'),
      }),
    ).toBe('PARTIALLY_PAID');
    expect(
      settlementStatus({
        ...common,
        remainingAmountMinor: 0,
        totalPaymentsMinor: 700,
      }),
    ).toBe('PAID');
    expect(
      settlementStatus({
        ...common,
        remainingAmountMinor: 500,
        totalPaymentsMinor: 0,
        now: new Date('2026-08-11'),
      }),
    ).toBe('OVERDUE');
    expect(
      settlementStatus({
        ...common,
        remainingAmountMinor: 0,
        totalPaymentsMinor: 0,
        totalWaivedMinor: 500,
      }),
    ).toBe('WAIVED');
    expect(
      settlementStatus({
        ...common,
        remainingAmountMinor: 500,
        totalPaymentsMinor: 0,
        now: new Date('2026-08-08T12:00:00.000Z'),
      }),
    ).toBe('DUE_SOON');
    expect(
      daysRemaining(
        new Date('2026-08-10T00:00:00.000Z'),
        new Date('2026-08-08T12:00:00.000Z'),
      ),
    ).toBe(2);
  });
});
