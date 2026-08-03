import { createHash, randomBytes } from 'node:crypto';

export type PhaseTwoOrderStatus =
  | 'DRAFT'
  | 'QUOTED'
  | 'SEARCHING_COURIER'
  | 'NO_COURIER_AVAILABLE'
  | 'NO_COURIER_AVAILABLE_FINAL'
  | 'CANCELLED';

export const courierAcceptanceWindowMs = 5 * 60 * 1_000;
export const maximumDispatchAttempts = 2;

export const freeMerchantCancellationStatuses = [
  'DRAFT',
  'QUOTED',
  'SEARCHING_COURIER',
  'NO_COURIER_AVAILABLE',
  'NO_COURIER_AVAILABLE_FINAL',
  'COURIER_ASSIGNED',
  'COURIER_ARRIVING_PICKUP',
  'AT_PICKUP',
] as const;

export const postPickupMerchantCancellationStatuses = [
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DROPOFF',
  'DELIVERY_FAILED',
  'RETURNING_TO_STORE',
] as const;

export function acceptanceDeadline(now = new Date()): Date {
  return new Date(now.getTime() + courierAcceptanceWindowMs);
}

export function acceptanceIsExpired(
  expiresAt: Date | null,
  now = new Date(),
): boolean {
  return expiresAt === null || expiresAt.getTime() <= now.getTime();
}

export function isFreeMerchantCancellationStatus(status: string): boolean {
  return (freeMerchantCancellationStatuses as readonly string[]).includes(
    status,
  );
}

export function isPostPickupMerchantCancellationStatus(
  status: string,
): boolean {
  return (postPickupMerchantCancellationStatuses as readonly string[]).includes(
    status,
  );
}

export function merchantCancellationDecision(
  status: string,
  originalDeliveryFeeMinor: number,
):
  | {
      kind: 'FREE';
      toStatus: 'CANCELLED';
      cancellationChargeMinor: 0;
    }
  | {
      kind: 'RETURN';
      toStatus: 'RETURNING_TO_STORE';
      cancellationChargeMinor: number;
    }
  | null {
  if (isFreeMerchantCancellationStatus(status)) {
    return {
      kind: 'FREE',
      toStatus: 'CANCELLED',
      cancellationChargeMinor: 0,
    };
  }
  if (isPostPickupMerchantCancellationStatus(status)) {
    return {
      kind: 'RETURN',
      toStatus: 'RETURNING_TO_STORE',
      cancellationChargeMinor: originalDeliveryFeeMinor,
    };
  }
  return null;
}

export function courierSearchTimeoutStatus(
  dispatchAttemptCount: number,
): 'NO_COURIER_AVAILABLE' | 'NO_COURIER_AVAILABLE_FINAL' {
  return dispatchAttemptCount >= maximumDispatchAttempts
    ? 'NO_COURIER_AVAILABLE_FINAL'
    : 'NO_COURIER_AVAILABLE';
}

export function canRetryCourierSearch(input: {
  status: string;
  dispatchAttemptCount: number;
  courierId: string | null;
}): boolean {
  return (
    input.status === 'NO_COURIER_AVAILABLE' &&
    input.dispatchAttemptCount === 1 &&
    input.courierId === null
  );
}

export const allOrderTransitions = {
  DRAFT: ['QUOTED', 'CANCELLED'],
  QUOTED: ['QUOTED', 'SEARCHING_COURIER', 'CANCELLED'],
  SEARCHING_COURIER: [
    'COURIER_ASSIGNED',
    'NO_COURIER_AVAILABLE',
    'NO_COURIER_AVAILABLE_FINAL',
    'CANCELLED',
  ],
  NO_COURIER_AVAILABLE: ['SEARCHING_COURIER', 'CANCELLED'],
  NO_COURIER_AVAILABLE_FINAL: ['CANCELLED'],
  COURIER_ASSIGNED: ['COURIER_ARRIVING_PICKUP', 'CANCELLED'],
  COURIER_ARRIVING_PICKUP: ['AT_PICKUP', 'CANCELLED'],
  AT_PICKUP: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'DELIVERY_FAILED', 'RETURNING_TO_STORE'],
  IN_TRANSIT: ['AT_DROPOFF', 'DELIVERY_FAILED', 'RETURNING_TO_STORE'],
  AT_DROPOFF: ['DELIVERED', 'DELIVERY_FAILED', 'RETURNING_TO_STORE'],
  DELIVERED: ['DELIVERY_DISPUTED', 'COMPLETED'],
  DELIVERY_DISPUTED: ['COMPLETED', 'DELIVERY_FAILED', 'RETURNING_TO_STORE'],
  DELIVERY_FAILED: ['RETURNING_TO_STORE'],
  RETURNING_TO_STORE: [
    'RETURNING_TO_STORE',
    'RETURN_AWAITING_MERCHANT_CONFIRMATION',
  ],
  RETURN_AWAITING_MERCHANT_CONFIRMATION: ['RETURNED'],
  RETURNED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
} as const;

export function canTransitionInPhaseThree(from: string, to: string): boolean {
  return (
    from in allOrderTransitions &&
    (
      allOrderTransitions[
        from as keyof typeof allOrderTransitions
      ] as readonly string[]
    ).includes(to)
  );
}

const phaseTwoTransitions: Record<
  PhaseTwoOrderStatus,
  readonly PhaseTwoOrderStatus[]
> = {
  DRAFT: ['QUOTED', 'CANCELLED'],
  QUOTED: ['QUOTED', 'SEARCHING_COURIER', 'CANCELLED'],
  SEARCHING_COURIER: [
    'NO_COURIER_AVAILABLE',
    'NO_COURIER_AVAILABLE_FINAL',
    'CANCELLED',
  ],
  NO_COURIER_AVAILABLE: ['SEARCHING_COURIER', 'CANCELLED'],
  NO_COURIER_AVAILABLE_FINAL: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransitionInPhaseTwo(from: string, to: string): boolean {
  return (
    from in phaseTwoTransitions &&
    phaseTwoTransitions[from as PhaseTwoOrderStatus].includes(
      to as PhaseTwoOrderStatus,
    )
  );
}

export function canCancelInPhaseTwo(input: {
  status: string;
  courierId: string | null;
}): boolean {
  return (
    isFreeMerchantCancellationStatus(input.status) &&
    (input.courierId === null ||
      ['COURIER_ASSIGNED', 'COURIER_ARRIVING_PICKUP', 'AT_PICKUP'].includes(
        input.status,
      ))
  );
}

export type PricingInput = {
  distanceMeters: number;
  packageSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  weightGrams: number;
  fragile: boolean;
  requiresThermalBag: boolean;
};

export type PricingRuleSnapshot = {
  baseFeeMinor: number;
  includedDistanceMeters: number;
  perKilometerMinor: number;
  minimumFeeMinor: number;
  smallPackageSurchargeMinor: number;
  mediumPackageSurchargeMinor: number;
  largePackageSurchargeMinor: number;
  weightBands: Array<{ upToGrams: number; surchargeMinor: number }>;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  commissionType: 'PERCENTAGE' | 'FIXED';
  commissionValue: number;
  taxBasisPoints: number;
  returnTripPercentageBasisPoints?: number;
};

export type PriceBreakdown = {
  baseFeeMinor: number;
  distanceChargeMinor: number;
  packageSurchargeMinor: number;
  weightSurchargeMinor: number;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  discountMinor: 0;
  surgeAdjustmentMinor: 0;
  taxMinor: number;
  merchantTotalMinor: number;
  estimatedCourierEarningMinor: number;
  platformCommissionMinor: number;
  platformCommissionBasisPoints: number;
  returnTripPercentageBasisPoints: number;
  estimatedReturnTripPriceMinor: number;
};

function roundRatio(
  multiplicand: number,
  multiplier: number,
  divisor: number,
): number {
  return Math.floor((multiplicand * multiplier + divisor / 2) / divisor);
}

export function calculatePrice(
  rule: PricingRuleSnapshot,
  input: PricingInput,
  commissionBasisPoints?: number,
): PriceBreakdown {
  const billableDistance = Math.max(
    0,
    input.distanceMeters - rule.includedDistanceMeters,
  );
  const rawDistanceCharge = roundRatio(
    billableDistance,
    rule.perKilometerMinor,
    1_000,
  );
  const packageSurchargeMinor =
    input.packageSize === 'SMALL'
      ? rule.smallPackageSurchargeMinor
      : input.packageSize === 'MEDIUM'
        ? rule.mediumPackageSurchargeMinor
        : rule.largePackageSurchargeMinor;
  const weightBand = [...rule.weightBands]
    .sort((left, right) => left.upToGrams - right.upToGrams)
    .find((band) => input.weightGrams <= band.upToGrams);
  const weightSurchargeMinor =
    weightBand?.surchargeMinor ?? rule.weightBands.at(-1)?.surchargeMinor ?? 0;
  const fragileSurchargeMinor = input.fragile ? rule.fragileSurchargeMinor : 0;
  const thermalBagSurchargeMinor = input.requiresThermalBag
    ? rule.thermalBagSurchargeMinor
    : 0;
  const extras =
    packageSurchargeMinor +
    weightSurchargeMinor +
    fragileSurchargeMinor +
    thermalBagSurchargeMinor;
  const distanceChargeMinor = Math.max(
    rawDistanceCharge,
    rule.minimumFeeMinor - rule.baseFeeMinor - extras,
    0,
  );
  const subtotal = rule.baseFeeMinor + distanceChargeMinor + extras;
  const taxMinor = roundRatio(subtotal, rule.taxBasisPoints, 10_000);
  const merchantTotalMinor = subtotal + taxMinor;
  const platformCommissionBasisPoints =
    commissionBasisPoints ??
    (rule.commissionType === 'PERCENTAGE' ? rule.commissionValue : 0);
  const platformCommissionMinor =
    commissionBasisPoints !== undefined || rule.commissionType === 'PERCENTAGE'
      ? roundRatio(merchantTotalMinor, platformCommissionBasisPoints, 10_000)
      : Math.min(rule.commissionValue, merchantTotalMinor);
  const returnTripPercentageBasisPoints =
    rule.returnTripPercentageBasisPoints ?? 7_000;

  return {
    baseFeeMinor: rule.baseFeeMinor,
    distanceChargeMinor,
    packageSurchargeMinor,
    weightSurchargeMinor,
    fragileSurchargeMinor,
    thermalBagSurchargeMinor,
    discountMinor: 0,
    surgeAdjustmentMinor: 0,
    taxMinor,
    merchantTotalMinor,
    estimatedCourierEarningMinor: merchantTotalMinor - platformCommissionMinor,
    platformCommissionMinor,
    platformCommissionBasisPoints,
    returnTripPercentageBasisPoints,
    estimatedReturnTripPriceMinor: roundRatio(
      merchantTotalMinor,
      returnTripPercentageBasisPoints,
      10_000,
    ),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function requestFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function quoteIsExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function createOrderNumber(now = new Date()): string {
  const date = now.toISOString().slice(2, 10).replaceAll('-', '');
  const entropy = randomBytes(5).toString('hex').toUpperCase();
  return `WSL-${date}-${entropy}`;
}

export type ResolvablePricingRule = {
  id: string;
  serviceZoneId: string | null;
  priority: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export function resolvePricingRule<T extends ResolvablePricingRule>(
  rules: readonly T[],
  input: { serviceZoneId: string; now?: Date },
): T | undefined {
  const now = input.now ?? new Date();
  return [...rules]
    .filter(
      (rule) =>
        (rule.serviceZoneId === null ||
          rule.serviceZoneId === input.serviceZoneId) &&
        rule.effectiveFrom <= now &&
        (rule.effectiveTo === null || rule.effectiveTo > now),
    )
    .sort((left, right) => {
      const specificity =
        Number(right.serviceZoneId !== null) -
        Number(left.serviceZoneId !== null);
      return (
        specificity ||
        right.priority - left.priority ||
        right.effectiveFrom.getTime() - left.effectiveFrom.getTime() ||
        left.id.localeCompare(right.id)
      );
    })[0];
}

export function overlappingRulePairs<T extends ResolvablePricingRule>(
  rules: readonly T[],
): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rules.length;
      rightIndex += 1
    ) {
      const left = rules[leftIndex];
      const right = rules[rightIndex];
      if (!left || !right) continue;
      const sameScope = left.serviceZoneId === right.serviceZoneId;
      const overlap =
        left.effectiveFrom < (right.effectiveTo ?? new Date('9999-12-31')) &&
        right.effectiveFrom < (left.effectiveTo ?? new Date('9999-12-31'));
      if (sameScope && overlap && left.priority === right.priority) {
        pairs.push([left, right]);
      }
    }
  }
  return pairs;
}

export function pointInPolygon(
  point: [longitude: number, latitude: number],
  polygon: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const intersects =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (intersects) inside = !inside;
  }
  return inside;
}
