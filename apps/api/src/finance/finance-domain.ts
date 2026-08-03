export const operationsTimezone = 'Africa/Cairo';

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type SettlementLineInput = {
  type:
    | 'COMMISSION_DUE'
    | 'EXTERNAL_PAYMENT'
    | 'ADJUSTMENT_DEBIT'
    | 'ADJUSTMENT_CREDIT'
    | 'WAIVER'
    | 'REVERSAL';
  amountMinor: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatters.set(timeZone, created);
  return created;
}

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function localDate(
  input: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  dayOffset: number,
): Pick<ZonedParts, 'year' | 'month' | 'day'> {
  const date = new Date(
    Date.UTC(input.year, input.month - 1, input.day + dayOffset),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function zonedDateTimeToUtc(
  input: ZonedParts,
  timeZone = operationsTimezone,
): Date {
  const target = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
  );
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = zonedParts(new Date(candidate), timeZone);
    const shownAsUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    const correction = target - shownAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

export function weeklySettlementBounds(
  occurredAt: Date,
  gracePeriodDays: number,
  timeZone = operationsTimezone,
): { periodStart: Date; periodEnd: Date; dueAt: Date } {
  const local = zonedParts(occurredAt, timeZone);
  const localDay = new Date(
    Date.UTC(local.year, local.month - 1, local.day),
  ).getUTCDay();
  const daysSinceMonday = (localDay + 6) % 7;
  const startDate = localDate(local, -daysSinceMonday);
  const endDate = localDate(startDate, 7);
  const dueDate = localDate(endDate, gracePeriodDays);
  const midnight = { hour: 0, minute: 0, second: 0 };
  return {
    periodStart: zonedDateTimeToUtc({ ...startDate, ...midnight }, timeZone),
    periodEnd: zonedDateTimeToUtc({ ...endDate, ...midnight }, timeZone),
    dueAt: zonedDateTimeToUtc({ ...dueDate, ...midnight }, timeZone),
  };
}

export function daysRemaining(
  dueAt: Date,
  now = new Date(),
  timeZone = operationsTimezone,
): number {
  const due = zonedParts(dueAt, timeZone);
  const current = zonedParts(now, timeZone);
  const dueDay = Date.UTC(due.year, due.month - 1, due.day);
  const currentDay = Date.UTC(current.year, current.month - 1, current.day);
  return Math.trunc((dueDay - currentDay) / 86_400_000);
}

export function roundBasisPoints(
  amountMinor: number,
  basisPoints: number,
): number {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10_000
  ) {
    throw new Error('Invalid basis-point calculation input.');
  }
  const result = (BigInt(amountMinor) * BigInt(basisPoints) + 5_000n) / 10_000n;
  const numeric = Number(result);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Basis-point calculation exceeded the safe integer range.');
  }
  return numeric;
}

export function settlementProjection(
  lines: readonly SettlementLineInput[],
  totalPaymentsMinor: number,
): {
  totalCommissionDueMinor: number;
  totalPaymentsMinor: number;
  totalAdjustmentsMinor: number;
  totalWaivedMinor: number;
  remainingAmountMinor: number;
} {
  const totalCommissionDueMinor = lines
    .filter((line) => line.type === 'COMMISSION_DUE')
    .reduce((total, line) => total + line.amountMinor, 0);
  const totalAdjustmentsMinor = lines
    .filter((line) =>
      ['ADJUSTMENT_DEBIT', 'ADJUSTMENT_CREDIT', 'REVERSAL'].includes(line.type),
    )
    .reduce((total, line) => total + line.amountMinor, 0);
  const totalWaivedMinor = Math.abs(
    lines
      .filter((line) => line.type === 'WAIVER')
      .reduce((total, line) => total + line.amountMinor, 0),
  );
  return {
    totalCommissionDueMinor,
    totalPaymentsMinor,
    totalAdjustmentsMinor,
    totalWaivedMinor,
    remainingAmountMinor: Math.max(
      0,
      totalCommissionDueMinor +
        totalAdjustmentsMinor -
        totalWaivedMinor -
        totalPaymentsMinor,
    ),
  };
}

export function allocateOldestSettlements(
  amountMinor: number,
  settlements: readonly {
    id: string;
    remainingAmountMinor: number;
    periodStart: Date;
  }[],
): Array<{ settlementPeriodId: string; amountMinor: number }> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Payment amount must be a positive integer.');
  }
  const available = settlements.reduce(
    (total, settlement) => total + settlement.remainingAmountMinor,
    0,
  );
  if (amountMinor > available) throw new Error('overpayment');
  let remaining = amountMinor;
  const allocations: Array<{
    settlementPeriodId: string;
    amountMinor: number;
  }> = [];
  for (const settlement of [...settlements].sort(
    (left, right) =>
      left.periodStart.getTime() - right.periodStart.getTime() ||
      left.id.localeCompare(right.id),
  )) {
    if (remaining === 0) break;
    const allocation = Math.min(remaining, settlement.remainingAmountMinor);
    if (allocation > 0) {
      allocations.push({
        settlementPeriodId: settlement.id,
        amountMinor: allocation,
      });
      remaining -= allocation;
    }
  }
  return allocations;
}

export function settlementStatus(input: {
  open: boolean;
  remainingAmountMinor: number;
  totalPaymentsMinor: number;
  totalAdjustmentsMinor: number;
  totalWaivedMinor: number;
  dueAt: Date;
  now?: Date;
}):
  | 'OPEN'
  | 'NOT_DUE'
  | 'DUE_SOON'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'WAIVED'
  | 'ADJUSTED' {
  if (input.open) return 'OPEN';
  if (input.remainingAmountMinor === 0) {
    if (input.totalWaivedMinor > 0 && input.totalPaymentsMinor === 0) {
      return 'WAIVED';
    }
    return 'PAID';
  }
  const now = input.now ?? new Date();
  if (now > input.dueAt) return 'OVERDUE';
  if (input.totalPaymentsMinor > 0) return 'PARTIALLY_PAID';
  if (input.totalAdjustmentsMinor !== 0 || input.totalWaivedMinor > 0) {
    return 'ADJUSTED';
  }
  return daysRemaining(input.dueAt, now) <= 2 ? 'DUE_SOON' : 'NOT_DUE';
}
