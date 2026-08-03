import { describe, expect, it } from 'vitest';

import { courierFinancialDetails } from './courier-order-presentation.js';

describe('courier order financial presentation', () => {
  it('keeps product value separate in delivery-only mode', () => {
    expect(
      courierFinancialDetails({
        currency: 'EGP',
        declaredValueMinor: 15_000,
        merchantTotalMinor: 3_500,
        estimatedCourierEarningMinor: 2_900,
        platformCommissionMinor: 600,
        paymentMode: 'DELIVERY_ONLY',
      }),
    ).toEqual({
      currency: 'EGP',
      itemsSubtotalMinor: 15_000,
      deliveryFeeMinor: 3_500,
      customerCollectAmountMinor: 3_500,
      courierNetEarningMinor: 2_900,
      platformCommissionMinor: 600,
      paymentMode: 'delivery_only',
      merchantPaymentRequiredMinor: 0,
    });
  });

  it('supports the future COD presentation without using item value as earnings', () => {
    const details = courierFinancialDetails({
      currency: 'EGP',
      declaredValueMinor: 15_000,
      merchantTotalMinor: 3_500,
      estimatedCourierEarningMinor: 2_900,
      platformCommissionMinor: 600,
      paymentMode: 'CASH_ON_DELIVERY',
    });

    expect(details.customerCollectAmountMinor).toBe(18_500);
    expect(details.courierNetEarningMinor).toBe(2_900);
    expect(details.merchantPaymentRequiredMinor).toBe(0);
  });

  it('accepts a zero-value order and rejects invalid persisted money', () => {
    expect(
      courierFinancialDetails({
        currency: 'EGP',
        declaredValueMinor: 0,
        merchantTotalMinor: 0,
        estimatedCourierEarningMinor: 0,
        platformCommissionMinor: 0,
        paymentMode: 'DELIVERY_ONLY',
      }).itemsSubtotalMinor,
    ).toBe(0);

    expect(() =>
      courierFinancialDetails({
        currency: 'EGP',
        declaredValueMinor: -1,
        merchantTotalMinor: 0,
        estimatedCourierEarningMinor: 0,
        platformCommissionMinor: 0,
        paymentMode: 'DELIVERY_ONLY',
      }),
    ).toThrow('non-negative integer');
  });
});
