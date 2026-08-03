import type { PrismaClient } from '@wasel/database';

const cairoOffsetMilliseconds = 3 * 60 * 60 * 1_000;

function weeklyBounds(now: Date, graceDays: number) {
  const cairo = new Date(now.getTime() + cairoOffsetMilliseconds);
  const day = cairo.getUTCDay();
  const daysSinceSaturday = (day + 1) % 7;
  const startCairo = Date.UTC(
    cairo.getUTCFullYear(),
    cairo.getUTCMonth(),
    cairo.getUTCDate() - daysSinceSaturday,
  );
  const periodStart = new Date(startCairo - cairoOffsetMilliseconds);
  const periodEnd = new Date(periodStart.getTime() + 7 * 86_400_000);
  return {
    periodStart,
    periodEnd,
    dueAt: new Date(periodEnd.getTime() + graceDays * 86_400_000),
  };
}

export async function completeDeliveredOrders(
  database: PrismaClient,
  now = new Date(),
): Promise<number> {
  const candidates = await database.deliveryOrder.findMany({
    where: {
      status: 'DELIVERED',
      financialFinalizedAt: null,
      deliveryDisputeDeadlineAt: { lte: now },
      deliveryDispute: null,
    },
    select: { id: true },
    orderBy: { deliveryDisputeDeadlineAt: 'asc' },
    take: 100,
  });
  let completedCount = 0;
  for (const candidate of candidates) {
    const completed = await database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "DeliveryOrder"
          WHERE "id" = ${candidate.id}::uuid
          FOR UPDATE
        `;
        const order = await transaction.deliveryOrder.findUnique({
          where: { id: candidate.id },
          include: {
            deliveryDispute: { select: { status: true } },
            merchant: {
              select: {
                memberships: {
                  where: { active: true, role: { in: ['OWNER', 'MANAGER'] } },
                  select: { userId: true },
                },
              },
            },
            courier: { select: { userId: true } },
          },
        });
        if (
          !order ||
          order.status !== 'DELIVERED' ||
          order.financialFinalizedAt ||
          !order.deliveryDisputeDeadlineAt ||
          order.deliveryDisputeDeadlineAt > now ||
          order.deliveryDispute ||
          !order.courierId ||
          !order.courier
        ) {
          return false;
        }
        const updated = await transaction.deliveryOrder.updateMany({
          where: {
            id: order.id,
            status: 'DELIVERED',
            financialFinalizedAt: null,
            version: order.version,
          },
          data: {
            status: 'COMPLETED',
            financialFinalizedAt: now,
            completedAt: now,
            completionSource: 'DISPUTE_WINDOW_EXPIRED',
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'ORDER_COMPLETED',
            fromStatus: 'DELIVERED',
            toStatus: 'COMPLETED',
            actorType: 'SYSTEM',
            source: 'WORKER',
            reasonCode: 'dispute_window_expired',
            merchantMessage: 'اكتمل الطلب بعد انتهاء نافذة الاعتراض.',
          },
        });
        const ledger = await transaction.courierLedgerEntry.create({
          data: {
            courierId: order.courierId,
            orderId: order.id,
            type: 'COMMISSION_DUE',
            amountMinor: order.platformCommissionMinor,
            currency: order.currency,
            sourceKey: `order:${order.id}:commission`,
            reason: 'Commission finalized after delivery dispute window.',
            occurredAt: now,
          },
        });
        const settings =
          await transaction.platformFinancialSetting.findFirstOrThrow({
            where: { effectiveFrom: { lte: now } },
            orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
          });
        const bounds = weeklyBounds(now, settings.gracePeriodDays);
        const settlement = await transaction.settlementPeriod.upsert({
          where: {
            courierId_periodStart_periodEnd: {
              courierId: order.courierId,
              periodStart: bounds.periodStart,
              periodEnd: bounds.periodEnd,
            },
          },
          update: {
            totalCommissionDueMinor: { increment: ledger.amountMinor },
            remainingAmountMinor: { increment: ledger.amountMinor },
            version: { increment: 1 },
          },
          create: {
            courierId: order.courierId,
            ...bounds,
            currency: order.currency,
            totalCommissionDueMinor: ledger.amountMinor,
            remainingAmountMinor: ledger.amountMinor,
          },
        });
        await transaction.settlementLine.create({
          data: {
            settlementPeriodId: settlement.id,
            ledgerEntryId: ledger.id,
            amountMinor: ledger.amountMinor,
          },
        });
        await transaction.courierProfile.update({
          where: { id: order.courierId },
          data: { completedOrdersCount: { increment: 1 } },
        });
        const recipients = [
          ...order.merchant.memberships.map((membership) => membership.userId),
          order.courier.userId,
        ];
        await transaction.notification.createMany({
          data: recipients.map((userId) => ({
            recipientUserId: userId,
            type: 'ORDER_COMPLETED',
            title: 'اكتمل الطلب',
            body: `اكتمل الطلب ${order.orderNumber} بعد نافذة الاعتراض.`,
            relatedEntityType: 'DeliveryOrder',
            relatedEntityId: order.id,
            deepLink: `/orders/${order.id}`,
            deduplicationKey: `order:${order.id}:completed:${userId}`,
          })),
          skipDuplicates: true,
        });
        await transaction.auditLog.create({
          data: {
            action: 'order.completed_after_dispute_window',
            entityType: 'DeliveryOrder',
            entityId: order.id,
            metadata: {
              courierId: order.courierId,
              ledgerEntryId: ledger.id,
              settlementPeriodId: settlement.id,
            },
          },
        });
        return true;
      },
      // The explicit order row lock is the concurrency boundary. Read
      // committed lets a duplicate worker wait, re-read, and exit cleanly
      // instead of surfacing a serialization failure to the queue.
      { isolationLevel: 'ReadCommitted' },
    );
    if (completed) completedCount += 1;
  }
  return completedCount;
}

export async function createOperationalReminders(
  database: PrismaClient,
  now = new Date(),
): Promise<number> {
  const admins = await database.user.findMany({
    where: {
      role: { in: ['OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN'] },
      status: 'ACTIVE',
    },
    select: { id: true, role: true },
  });
  const disputes = await database.deliveryDispute.findMany({
    where: {
      status: { in: ['OPEN', 'COURIER_RESPONDED'] },
      createdAt: { lte: new Date(now.getTime() - 4 * 60 * 60 * 1_000) },
    },
    select: { id: true, order: { select: { orderNumber: true } } },
    take: 100,
  });
  const proofs = await database.courierPaymentProof.findMany({
    where: {
      status: 'PENDING_CONFIRMATION',
      createdAt: { lte: new Date(now.getTime() - 4 * 60 * 60 * 1_000) },
    },
    select: { id: true },
    take: 100,
  });
  const data = [
    ...disputes.flatMap((dispute) =>
      admins
        .filter((admin) =>
          ['OPERATIONS_ADMIN', 'SUPER_ADMIN'].includes(admin.role),
        )
        .map((admin) => ({
          recipientUserId: admin.id,
          type: 'DISPUTE_REVIEW_REMINDER',
          title: 'اعتراض ينتظر المراجعة',
          body: `الطلب ${dispute.order.orderNumber} ينتظر قرار العمليات.`,
          relatedEntityType: 'DeliveryDispute',
          relatedEntityId: dispute.id,
          deepLink: `/delivery-disputes/${dispute.id}`,
          deduplicationKey: `reminder:dispute:${dispute.id}:${admin.id}`,
        })),
    ),
    ...proofs.flatMap((proof) =>
      admins
        .filter((admin) =>
          ['FINANCE_ADMIN', 'SUPER_ADMIN'].includes(admin.role),
        )
        .map((admin) => ({
          recipientUserId: admin.id,
          type: 'PAYMENT_PROOF_REVIEW_REMINDER',
          title: 'إثبات دفع ينتظر المراجعة',
          body: 'يوجد إثبات دفع معلق يحتاج مراجعة المالية.',
          relatedEntityType: 'CourierPaymentProof',
          relatedEntityId: proof.id,
          deepLink: `/payment-proofs/${proof.id}`,
          deduplicationKey: `reminder:proof:${proof.id}:${admin.id}`,
        })),
    ),
  ];
  if (data.length === 0) return 0;
  const result = await database.notification.createMany({
    data,
    skipDuplicates: true,
  });
  return result.count;
}

export async function deleteExpiredReadNotifications(
  database: PrismaClient,
  now = new Date(),
): Promise<number> {
  const setting = await database.platformOperationalSetting.findFirst({
    where: { effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  const retentionDays = setting?.notificationRetentionDays ?? 90;
  const result = await database.notification.deleteMany({
    where: {
      readAt: { not: null },
      createdAt: {
        lt: new Date(now.getTime() - retentionDays * 86_400_000),
      },
    },
  });
  return result.count;
}
