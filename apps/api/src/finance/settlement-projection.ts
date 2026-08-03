import type { Prisma } from '@wasel/database';

import { settlementProjection, settlementStatus } from './finance-domain.js';

export async function refreshSettlementProjection(
  transaction: Prisma.TransactionClient,
  settlementPeriodId: string,
  now = new Date(),
) {
  const settlement = await transaction.settlementPeriod.findUniqueOrThrow({
    where: { id: settlementPeriodId },
    include: {
      lines: {
        include: {
          ledgerEntry: {
            select: { type: true, amountMinor: true },
          },
        },
      },
      paymentAllocations: {
        include: {
          payment: {
            select: {
              reversesPaymentId: true,
              reversedBy: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  const activePayments = settlement.paymentAllocations
    .filter(
      (allocation) =>
        allocation.payment.reversesPaymentId === null &&
        allocation.payment.reversedBy === null,
    )
    .reduce((total, allocation) => total + allocation.amountMinor, 0);
  const projection = settlementProjection(
    settlement.lines
      .map(({ ledgerEntry }) => ledgerEntry)
      .filter((entry) => entry.type !== 'EXTERNAL_PAYMENT'),
    activePayments,
  );
  const status = settlementStatus({
    open: settlement.status === 'OPEN',
    ...projection,
    dueAt: settlement.dueAt,
    now,
  });
  return transaction.settlementPeriod.update({
    where: { id: settlement.id },
    data: {
      ...projection,
      status,
      version: { increment: 1 },
    },
  });
}
