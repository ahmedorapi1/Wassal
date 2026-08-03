import type { PrismaClient } from '@wasel/database';

export async function closeEligibleSettlements(
  database: PrismaClient,
  now = new Date(),
): Promise<number> {
  const candidates = await database.settlementPeriod.findMany({
    where: { status: 'OPEN', periodEnd: { lte: now } },
    select: { id: true },
    orderBy: [{ periodEnd: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  let closed = 0;
  for (const candidate of candidates) {
    const didClose = await database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "SettlementPeriod"
          WHERE "id" = ${candidate.id}::uuid
          FOR UPDATE
        `;
        const settlement = await transaction.settlementPeriod.findUnique({
          where: { id: candidate.id },
        });
        if (
          !settlement ||
          settlement.status !== 'OPEN' ||
          settlement.periodEnd > now
        ) {
          return false;
        }
        await transaction.$executeRaw`
          INSERT INTO "SettlementLine" (
            "id",
            "settlementPeriodId",
            "ledgerEntryId",
            "amountMinor",
            "createdAt"
          )
          SELECT
            gen_random_uuid(),
            ${settlement.id}::uuid,
            entry."id",
            entry."amountMinor",
            ${now}
          FROM "CourierLedgerEntry" AS entry
          WHERE entry."courierId" = ${settlement.courierId}::uuid
            AND entry."occurredAt" >= ${settlement.periodStart}
            AND entry."occurredAt" < ${settlement.periodEnd}
          ON CONFLICT ("ledgerEntryId") DO NOTHING
        `;
        await transaction.$executeRaw`
          WITH line_totals AS (
            SELECT
              COALESCE(SUM(entry."amountMinor") FILTER (
                WHERE entry."type" = 'COMMISSION_DUE'
              ), 0)::integer AS commission,
              COALESCE(SUM(entry."amountMinor") FILTER (
                WHERE entry."type" IN (
                  'ADJUSTMENT_DEBIT',
                  'ADJUSTMENT_CREDIT',
                  'REVERSAL'
                )
              ), 0)::integer AS adjustments,
              ABS(COALESCE(SUM(entry."amountMinor") FILTER (
                WHERE entry."type" = 'WAIVER'
              ), 0))::integer AS waived
            FROM "SettlementLine" AS line
            JOIN "CourierLedgerEntry" AS entry
              ON entry."id" = line."ledgerEntryId"
            WHERE line."settlementPeriodId" = ${settlement.id}::uuid
          ),
          payment_totals AS (
            SELECT COALESCE(SUM(allocation."amountMinor"), 0)::integer AS paid
            FROM "ExternalPaymentAllocation" AS allocation
            JOIN "ExternalPaymentRecord" AS payment
              ON payment."id" = allocation."paymentId"
            LEFT JOIN "ExternalPaymentRecord" AS reversal
              ON reversal."reversesPaymentId" = payment."id"
            WHERE allocation."settlementPeriodId" = ${settlement.id}::uuid
              AND payment."reversesPaymentId" IS NULL
              AND reversal."id" IS NULL
          ),
          totals AS (
            SELECT
              line_totals.commission,
              line_totals.adjustments,
              line_totals.waived,
              payment_totals.paid,
              GREATEST(
                0,
                line_totals.commission + line_totals.adjustments
                  - line_totals.waived - payment_totals.paid
              )::integer AS remaining
            FROM line_totals, payment_totals
          )
          UPDATE "SettlementPeriod" AS period
          SET
            "totalCommissionDueMinor" = totals.commission,
            "totalPaymentsMinor" = totals.paid,
            "totalAdjustmentsMinor" = totals.adjustments,
            "totalWaivedMinor" = totals.waived,
            "remainingAmountMinor" = totals.remaining,
            "status" = CASE
              WHEN totals.remaining = 0 THEN 'PAID'::"CourierSettlementStatus"
              WHEN period."dueAt" < ${now} THEN 'OVERDUE'::"CourierSettlementStatus"
              WHEN period."dueAt" <= ${new Date(now.getTime() + 2 * 86_400_000)}
                THEN 'DUE_SOON'::"CourierSettlementStatus"
              ELSE 'NOT_DUE'::"CourierSettlementStatus"
            END,
            "closedAt" = ${now},
            "version" = period."version" + 1,
            "updatedAt" = ${now}
          FROM totals
          WHERE period."id" = ${settlement.id}::uuid
            AND period."status" = 'OPEN'
        `;
        await transaction.auditLog.create({
          data: {
            action: 'settlement.closed_by_worker',
            entityType: 'SettlementPeriod',
            entityId: settlement.id,
            metadata: { courierId: settlement.courierId },
          },
        });
        return true;
      },
      { isolationLevel: 'Serializable' },
    );
    if (didClose) closed += 1;
  }
  return closed;
}

export async function markOverdueSettlements(
  database: PrismaClient,
  now = new Date(),
): Promise<number> {
  const result = await database.settlementPeriod.updateMany({
    where: {
      status: {
        in: ['CLOSED', 'NOT_DUE', 'DUE_SOON', 'PARTIALLY_PAID', 'ADJUSTED'],
      },
      remainingAmountMinor: { gt: 0 },
      dueAt: { lt: now },
      closedAt: { not: null },
    },
    data: { status: 'OVERDUE', version: { increment: 1 } },
  });
  return result.count;
}
