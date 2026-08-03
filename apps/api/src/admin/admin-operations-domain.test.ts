import { describe, expect, it } from 'vitest';

import {
  attributePaymentsToZones,
  cairoPeriodBounds,
  coreDeliveryPriceMinor,
  pricingRemovalDecision,
  returnTripPriceMinor,
} from './admin-operations-domain.js';

describe('admin operations domain', () => {
  it('charges only the base fee within the included distance', () => {
    expect(
      coreDeliveryPriceMinor({
        baseFeeMinor: 1_500,
        includedDistanceMeters: 2_000,
        perKilometerMinor: 500,
        distanceMeters: 1_900,
      }),
    ).toBe(1_500);
  });

  it('charges the configured rate only for distance over the allowance', () => {
    expect(
      coreDeliveryPriceMinor({
        baseFeeMinor: 1_500,
        includedDistanceMeters: 2_000,
        perKilometerMinor: 500,
        distanceMeters: 3_500,
      }),
    ).toBe(2_250);
  });

  it('matches the Damietta 25 EGP / 2 km / 5 EGP pricing example', () => {
    const damiettaRule = {
      baseFeeMinor: 2_500,
      includedDistanceMeters: 2_000,
      perKilometerMinor: 500,
    };
    expect(
      coreDeliveryPriceMinor({ ...damiettaRule, distanceMeters: 2_000 }),
    ).toBe(2_500);
    expect(
      coreDeliveryPriceMinor({ ...damiettaRule, distanceMeters: 6_000 }),
    ).toBe(4_500);
  });

  it('calculates a return trip at seventy percent without commission', () => {
    expect(returnTripPriceMinor(2_250)).toBe(1_575);
  });

  it.each([
    ['ACTIVE', 0, 0, 'BLOCK_ACTIVE'],
    ['INACTIVE', 1, 0, 'ARCHIVE_USED'],
    ['RETIRED', 0, 1, 'ARCHIVE_USED'],
    ['DRAFT', 0, 0, 'DELETE'],
  ] as const)(
    'protects pricing history when removing a %s rule',
    (status, quoteCount, orderCount, expected) => {
      expect(pricingRemovalDecision({ status, quoteCount, orderCount })).toBe(
        expected,
      );
    },
  );

  it('uses Cairo calendar boundaries instead of server-local midnight', () => {
    const bounds = cairoPeriodBounds(new Date('2026-07-29T22:30:00.000Z'));
    expect(bounds.todayStart.toISOString()).toBe('2026-07-29T21:00:00.000Z');
    expect(bounds.tomorrowStart.toISOString()).toBe('2026-07-30T21:00:00.000Z');
    expect(bounds.monthStart.toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });

  it('attributes every payment cent to source-order zones deterministically', () => {
    const lines = [
      {
        settlementPeriodId: 'period',
        serviceZoneId: 'zone-a',
        amountMinor: 100,
        courierId: 'courier',
        occurredAt: new Date(),
      },
      {
        settlementPeriodId: 'period',
        serviceZoneId: 'zone-b',
        amountMinor: 200,
        courierId: 'courier',
        occurredAt: new Date(),
      },
    ];
    const attributed = attributePaymentsToZones(lines, [
      {
        settlementPeriodId: 'period',
        paymentId: 'payment',
        amountMinor: 100,
        paidAt: new Date(),
        courierId: 'courier',
      },
    ]);
    expect(
      attributed.reduce(
        (sum, allocation) => sum + allocation.attributedAmountMinor,
        0,
      ),
    ).toBe(100);
    expect(attributed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceZoneId: 'zone-a',
          attributedAmountMinor: 33,
        }),
        expect.objectContaining({
          serviceZoneId: 'zone-b',
          attributedAmountMinor: 67,
        }),
      ]),
    );
  });
});
