type CourierFinancialOrder = {
  currency: string;
  declaredValueMinor: number;
  estimatedCourierEarningMinor: number;
  merchantTotalMinor: number;
  paymentMode: 'DELIVERY_ONLY' | 'CASH_ON_DELIVERY';
  platformCommissionMinor: number;
};

export type CourierFinancialDetails = {
  currency: string;
  customerCollectAmountMinor: number;
  courierNetEarningMinor: number;
  deliveryFeeMinor: number;
  itemsSubtotalMinor: number;
  merchantPaymentRequiredMinor: number;
  paymentMode: 'delivery_only' | 'cash_on_delivery';
  platformCommissionMinor: number;
};

export function courierFinancialDetails(
  order: CourierFinancialOrder,
): CourierFinancialDetails {
  const itemsSubtotalMinor = moneyMinor(order.declaredValueMinor);
  const deliveryFeeMinor = moneyMinor(order.merchantTotalMinor);
  const platformCommissionMinor = moneyMinor(order.platformCommissionMinor);
  const courierNetEarningMinor = moneyMinor(order.estimatedCourierEarningMinor);

  return {
    itemsSubtotalMinor,
    deliveryFeeMinor,
    customerCollectAmountMinor:
      order.paymentMode === 'CASH_ON_DELIVERY'
        ? itemsSubtotalMinor + deliveryFeeMinor
        : deliveryFeeMinor,
    courierNetEarningMinor,
    platformCommissionMinor,
    currency: order.currency,
    paymentMode:
      order.paymentMode === 'CASH_ON_DELIVERY'
        ? 'cash_on_delivery'
        : 'delivery_only',
    // SKKA does not make a courier finance the merchant's products at pickup.
    merchantPaymentRequiredMinor: 0,
  };
}

function moneyMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Persisted order money must be a non-negative integer.');
  }
  return value;
}
