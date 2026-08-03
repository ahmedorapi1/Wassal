import { describe, expect, it } from 'vitest';

import {
  acceptanceDeadline,
  acceptanceIsExpired,
  calculatePrice,
  canCancelInPhaseTwo,
  canRetryCourierSearch,
  canTransitionInPhaseTwo,
  canTransitionInPhaseThree,
  courierSearchTimeoutStatus,
  createOrderNumber,
  merchantCancellationDecision,
  overlappingRulePairs,
  pointInPolygon,
  quoteIsExpired,
  requestFingerprint,
  resolvePricingRule,
} from './order-domain.js';

const rule = {
  baseFeeMinor: 1_500,
  includedDistanceMeters: 1_000,
  perKilometerMinor: 500,
  minimumFeeMinor: 2_000,
  smallPackageSurchargeMinor: 0,
  mediumPackageSurchargeMinor: 200,
  largePackageSurchargeMinor: 500,
  weightBands: [
    { upToGrams: 5_000, surchargeMinor: 0 },
    { upToGrams: 15_000, surchargeMinor: 400 },
  ],
  fragileSurchargeMinor: 250,
  thermalBagSurchargeMinor: 150,
  commissionType: 'PERCENTAGE' as const,
  commissionValue: 1_500,
  taxBasisPoints: 0,
};

describe('Phase 2 order domain', () => {
  it('calculates integer-minor-unit money deterministically', () => {
    expect(
      calculatePrice(rule, {
        distanceMeters: 3_501,
        packageSize: 'MEDIUM',
        weightGrams: 6_000,
        fragile: true,
        requiresThermalBag: true,
      }),
    ).toEqual({
      baseFeeMinor: 1_500,
      distanceChargeMinor: 1_251,
      packageSurchargeMinor: 200,
      weightSurchargeMinor: 400,
      fragileSurchargeMinor: 250,
      thermalBagSurchargeMinor: 150,
      discountMinor: 0,
      surgeAdjustmentMinor: 0,
      taxMinor: 0,
      merchantTotalMinor: 3_751,
      estimatedCourierEarningMinor: 3_188,
      platformCommissionMinor: 563,
      platformCommissionBasisPoints: 1_500,
      returnTripPercentageBasisPoints: 7_000,
      estimatedReturnTripPriceMinor: 2_626,
    });
  });

  it('executes the Phase 3 lifecycle but keeps financial completion explicit', () => {
    expect(
      canTransitionInPhaseThree('SEARCHING_COURIER', 'COURIER_ASSIGNED'),
    ).toBe(true);
    expect(canTransitionInPhaseThree('DELIVERED', 'COMPLETED')).toBe(true);
    expect(canTransitionInPhaseThree('RETURNED', 'COMPLETED')).toBe(true);
    expect(canTransitionInPhaseThree('PICKED_UP', 'CANCELLED')).toBe(false);
    expect(canTransitionInPhaseThree('AT_PICKUP', 'COMPLETED')).toBe(false);
    expect(canTransitionInPhaseThree('COMPLETED', 'IN_TRANSIT')).toBe(false);
  });

  it('allows the versioned platform setting to override a historical pricing-rule rate', () => {
    expect(
      calculatePrice(
        { ...rule, commissionValue: 1_500 },
        {
          distanceMeters: 18_000,
          packageSize: 'SMALL',
          weightGrams: 500,
          fragile: false,
          requiresThermalBag: false,
        },
        2_000,
      ),
    ).toMatchObject({
      merchantTotalMinor: 10_000,
      platformCommissionBasisPoints: 2_000,
      platformCommissionMinor: 2_000,
      estimatedCourierEarningMinor: 8_000,
    });
  });

  it('includes a seventy-percent return-trip estimate without adding commission', () => {
    const price = calculatePrice(
      {
        baseFeeMinor: 1_500,
        includedDistanceMeters: 1_000,
        perKilometerMinor: 500,
        minimumFeeMinor: 1_500,
        smallPackageSurchargeMinor: 0,
        mediumPackageSurchargeMinor: 0,
        largePackageSurchargeMinor: 0,
        weightBands: [{ upToGrams: 25_000, surchargeMinor: 0 }],
        fragileSurchargeMinor: 0,
        thermalBagSurchargeMinor: 0,
        commissionType: 'PERCENTAGE',
        commissionValue: 2_000,
        taxBasisPoints: 0,
        returnTripPercentageBasisPoints: 7_000,
      },
      {
        distanceMeters: 2_000,
        packageSize: 'SMALL',
        weightGrams: 1_000,
        fragile: false,
        requiresThermalBag: false,
      },
    );
    expect(price.merchantTotalMinor).toBe(2_000);
    expect(price.platformCommissionMinor).toBe(400);
    expect(price.estimatedReturnTripPriceMinor).toBe(1_400);
  });

  it('preserves the historical rate when newer platform settings change', () => {
    const quotedAtTwentyPercent = calculatePrice(
      rule,
      {
        distanceMeters: 18_000,
        packageSize: 'SMALL',
        weightGrams: 500,
        fragile: false,
        requiresThermalBag: false,
      },
      2_000,
    );
    const laterSetting = 2_500;
    expect(laterSetting).not.toBe(
      quotedAtTwentyPercent.platformCommissionBasisPoints,
    );
    expect(quotedAtTwentyPercent).toMatchObject({
      platformCommissionBasisPoints: 2_000,
      platformCommissionMinor: 2_000,
    });
  });

  it('enforces the Phase 2 state and cancellation policy', () => {
    expect(canTransitionInPhaseTwo('QUOTED', 'SEARCHING_COURIER')).toBe(true);
    expect(
      canTransitionInPhaseTwo('SEARCHING_COURIER', 'COURIER_ASSIGNED'),
    ).toBe(false);
    expect(
      canCancelInPhaseTwo({ status: 'SEARCHING_COURIER', courierId: null }),
    ).toBe(true);
    expect(
      canCancelInPhaseTwo({
        status: 'COURIER_ASSIGNED',
        courierId: 'courier',
      }),
    ).toBe(true);
  });

  describe('merchant cancellation and courier acceptance policy', () => {
    const now = new Date('2026-08-02T10:00:00.000Z');

    it('opens each courier acceptance window for exactly five minutes', () => {
      expect(acceptanceDeadline(now).toISOString()).toBe(
        '2026-08-02T10:05:00.000Z',
      );
    });

    it('keeps acceptance valid immediately before the deadline', () => {
      expect(
        acceptanceIsExpired(
          acceptanceDeadline(now),
          new Date('2026-08-02T10:04:59.999Z'),
        ),
      ).toBe(false);
    });

    it('expires acceptance exactly at the deadline', () => {
      expect(
        acceptanceIsExpired(acceptanceDeadline(now), acceptanceDeadline(now)),
      ).toBe(true);
    });

    it('cancels a searching order without a charge', () => {
      expect(merchantCancellationDecision('SEARCHING_COURIER', 3_500)).toEqual({
        kind: 'FREE',
        toStatus: 'CANCELLED',
        cancellationChargeMinor: 0,
      });
    });

    it('cancels an assigned order without a charge before pickup', () => {
      expect(
        merchantCancellationDecision('COURIER_ASSIGNED', 3_500),
      ).toMatchObject({ kind: 'FREE', cancellationChargeMinor: 0 });
    });

    it('cancels while the courier is heading to pickup without a charge', () => {
      expect(
        merchantCancellationDecision('COURIER_ARRIVING_PICKUP', 3_500),
      ).toMatchObject({ kind: 'FREE', cancellationChargeMinor: 0 });
    });

    it('cancels at the pickup location without a charge before possession', () => {
      expect(merchantCancellationDecision('AT_PICKUP', 3_500)).toMatchObject({
        kind: 'FREE',
        toStatus: 'CANCELLED',
      });
    });

    it('converts cancellation immediately after pickup into a return', () => {
      expect(merchantCancellationDecision('PICKED_UP', 3_500)).toEqual({
        kind: 'RETURN',
        toStatus: 'RETURNING_TO_STORE',
        cancellationChargeMinor: 3_500,
      });
    });

    it('preserves the complete original delivery fee while in transit', () => {
      expect(
        merchantCancellationDecision('IN_TRANSIT', 4_725)
          ?.cancellationChargeMinor,
      ).toBe(4_725);
    });

    it('uses the same return path after a delivery failure', () => {
      expect(
        merchantCancellationDecision('DELIVERY_FAILED', 3_500)?.toStatus,
      ).toBe('RETURNING_TO_STORE');
    });

    it('does not add a separate return price to post-pickup cancellation', () => {
      const decision = merchantCancellationDecision('AT_DROPOFF', 3_500);
      expect(decision?.cancellationChargeMinor).toBe(3_500);
    });

    it('rejects cancellation after delivery is already reported complete', () => {
      expect(merchantCancellationDecision('DELIVERED', 3_500)).toBeNull();
    });

    it('rejects cancellation for terminal completed orders', () => {
      expect(merchantCancellationDecision('COMPLETED', 3_500)).toBeNull();
    });

    it('moves the first expired attempt to retryable unavailable', () => {
      expect(courierSearchTimeoutStatus(1)).toBe('NO_COURIER_AVAILABLE');
    });

    it('moves the second expired attempt to final unavailable', () => {
      expect(courierSearchTimeoutStatus(2)).toBe('NO_COURIER_AVAILABLE_FINAL');
    });

    it('allows exactly one retry for an unassigned first timeout', () => {
      expect(
        canRetryCourierSearch({
          status: 'NO_COURIER_AVAILABLE',
          dispatchAttemptCount: 1,
          courierId: null,
        }),
      ).toBe(true);
    });

    it('rejects retry when a courier has already been assigned', () => {
      expect(
        canRetryCourierSearch({
          status: 'NO_COURIER_AVAILABLE',
          dispatchAttemptCount: 1,
          courierId: 'courier',
        }),
      ).toBe(false);
    });

    it('rejects a third dispatch attempt', () => {
      expect(
        canRetryCourierSearch({
          status: 'NO_COURIER_AVAILABLE_FINAL',
          dispatchAttemptCount: 2,
          courierId: null,
        }),
      ).toBe(false);
    });
  });

  it('fingerprints canonical payloads and detects expiry', () => {
    expect(requestFingerprint({ b: 2, a: 1 })).toBe(
      requestFingerprint({ a: 1, b: 2 }),
    );
    expect(quoteIsExpired(new Date('2026-01-01'), new Date('2026-01-02'))).toBe(
      true,
    );
  });

  it('generates support-safe, non-primary-key order numbers', () => {
    expect(createOrderNumber(new Date('2026-07-23'))).toMatch(
      /^WSL-260723-[A-F0-9]{10}$/,
    );
  });

  it('resolves the most specific and highest-priority pricing rule', () => {
    const now = new Date('2026-07-23');
    const base = {
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: null,
    };
    expect(
      resolvePricingRule(
        [
          { id: 'global', serviceZoneId: null, priority: 99, ...base },
          { id: 'zone-low', serviceZoneId: 'zone', priority: 1, ...base },
          { id: 'zone-high', serviceZoneId: 'zone', priority: 2, ...base },
        ],
        { serviceZoneId: 'zone', now },
      )?.id,
    ).toBe('zone-high');
  });

  it('detects ambiguous overlapping rules', () => {
    const base = {
      serviceZoneId: 'zone',
      priority: 1,
      effectiveFrom: new Date('2026-01-01'),
      effectiveTo: null,
    };
    expect(
      overlappingRulePairs([
        { id: 'one', ...base },
        { id: 'two', ...base },
      ]),
    ).toHaveLength(1);
  });

  it('checks local zone containment without frontend authority', () => {
    const polygon = [
      [31.7, 31.3],
      [31.9, 31.3],
      [31.9, 31.5],
      [31.7, 31.5],
      [31.7, 31.3],
    ] as const;
    expect(pointInPolygon([31.81, 31.42], polygon)).toBe(true);
    expect(pointInPolygon([32, 31.42], polygon)).toBe(false);
  });
});
