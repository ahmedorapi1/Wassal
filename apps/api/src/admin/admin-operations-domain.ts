import {
  operationsTimezone,
  zonedDateTimeToUtc,
} from '../finance/finance-domain.js';

export function coreDeliveryPriceMinor(input: {
  baseFeeMinor: number;
  includedDistanceMeters: number;
  perKilometerMinor: number;
  distanceMeters: number;
}): number {
  const extraMeters = Math.max(
    0,
    input.distanceMeters - input.includedDistanceMeters,
  );
  const distanceCharge = Math.floor(
    (extraMeters * input.perKilometerMinor + 500) / 1_000,
  );
  return input.baseFeeMinor + distanceCharge;
}

export function returnTripPriceMinor(
  originalTripPriceMinor: number,
  percentageBasisPoints = 7_000,
): number {
  if (
    !Number.isSafeInteger(originalTripPriceMinor) ||
    originalTripPriceMinor < 0 ||
    !Number.isInteger(percentageBasisPoints) ||
    percentageBasisPoints < 0 ||
    percentageBasisPoints > 10_000
  ) {
    throw new Error('Invalid return-trip calculation input.');
  }
  return Math.floor(
    (originalTripPriceMinor * percentageBasisPoints + 5_000) / 10_000,
  );
}

export type PricingRemovalDecision = 'BLOCK_ACTIVE' | 'ARCHIVE_USED' | 'DELETE';

export function pricingRemovalDecision(input: {
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  quoteCount: number;
  orderCount: number;
}): PricingRemovalDecision {
  if (input.status === 'ACTIVE') return 'BLOCK_ACTIVE';
  if (input.quoteCount > 0 || input.orderCount > 0) return 'ARCHIVE_USED';
  return 'DELETE';
}

export function cairoPeriodBounds(now = new Date()): {
  todayStart: Date;
  tomorrowStart: Date;
  monthStart: Date;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: operationsTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = parts.year ?? now.getUTCFullYear();
  const month = parts.month ?? now.getUTCMonth() + 1;
  const day = parts.day ?? now.getUTCDate();
  const midnight = { hour: 0, minute: 0, second: 0 };
  const todayStart = zonedDateTimeToUtc(
    { year, month, day, ...midnight },
    operationsTimezone,
  );
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const tomorrowStart = zonedDateTimeToUtc(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      ...midnight,
    },
    operationsTimezone,
  );
  const monthStart = zonedDateTimeToUtc(
    { year, month, day: 1, ...midnight },
    operationsTimezone,
  );
  return { todayStart, tomorrowStart, monthStart };
}

export type ZoneSettlementLine = {
  settlementPeriodId: string;
  serviceZoneId: string;
  amountMinor: number;
  courierId: string;
  occurredAt: Date;
};

export type ZonePaymentAllocation = {
  settlementPeriodId: string;
  paymentId: string;
  amountMinor: number;
  paidAt: Date;
  courierId: string;
};

export type AttributedZonePayment = ZonePaymentAllocation & {
  serviceZoneId: string;
  attributedAmountMinor: number;
};

/**
 * Existing payments are allocated to settlement periods, while their lines
 * retain the source order and its zone. Attribute every payment by the
 * positive line balance in that same period using largest remainders. This
 * keeps every cent accounted for without inventing a second settlement model.
 */
export function attributePaymentsToZones(
  lines: readonly ZoneSettlementLine[],
  allocations: readonly ZonePaymentAllocation[],
): AttributedZonePayment[] {
  const linesByPeriod = new Map<string, ZoneSettlementLine[]>();
  for (const line of lines) {
    const rows = linesByPeriod.get(line.settlementPeriodId) ?? [];
    rows.push(line);
    linesByPeriod.set(line.settlementPeriodId, rows);
  }
  const output: AttributedZonePayment[] = [];
  for (const allocation of allocations) {
    const periodLines = linesByPeriod.get(allocation.settlementPeriodId) ?? [];
    const dueByZone = new Map<string, number>();
    for (const line of periodLines) {
      dueByZone.set(
        line.serviceZoneId,
        (dueByZone.get(line.serviceZoneId) ?? 0) + line.amountMinor,
      );
    }
    const positive = [...dueByZone.entries()]
      .map(([serviceZoneId, amount]) => ({
        serviceZoneId,
        amount: Math.max(0, amount),
      }))
      .filter((row) => row.amount > 0);
    const total = positive.reduce((sum, row) => sum + row.amount, 0);
    if (total === 0) continue;
    const apportioned = positive.map((row) => {
      const numerator = allocation.amountMinor * row.amount;
      return {
        serviceZoneId: row.serviceZoneId,
        attributedAmountMinor: Math.floor(numerator / total),
        remainder: numerator % total,
      };
    });
    let remaining =
      allocation.amountMinor -
      apportioned.reduce((sum, row) => sum + row.attributedAmountMinor, 0);
    apportioned.sort(
      (left, right) =>
        right.remainder - left.remainder ||
        left.serviceZoneId.localeCompare(right.serviceZoneId),
    );
    for (const row of apportioned) {
      if (remaining <= 0) break;
      row.attributedAmountMinor += 1;
      remaining -= 1;
    }
    for (const row of apportioned) {
      output.push({
        ...allocation,
        serviceZoneId: row.serviceZoneId,
        attributedAmountMinor: row.attributedAmountMinor,
      });
    }
  }
  return output;
}
