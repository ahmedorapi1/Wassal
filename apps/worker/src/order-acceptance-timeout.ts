import type { Prisma, PrismaClient } from '@wasel/database';

export type WorkerRealtimePublisher = (
  room: string,
  type: string,
  payload: Readonly<Record<string, unknown>>,
) => Promise<void> | void;

type ExpiredOrderResult = {
  orderId: string;
  merchantId: string;
  serviceZoneId: string;
  status: 'NO_COURIER_AVAILABLE' | 'NO_COURIER_AVAILABLE_FINAL';
  version: number;
  attempt: number;
  notifications: Array<{ id: string; userId: string; type: string }>;
};

export async function expireCourierAcceptanceWindows(
  database: PrismaClient,
  now = new Date(),
  publish?: WorkerRealtimePublisher,
): Promise<number> {
  const candidates = await database.deliveryOrder.findMany({
    where: {
      status: 'SEARCHING_COURIER',
      courierId: null,
      acceptanceExpiresAt: { lte: now },
    },
    select: { id: true },
    orderBy: { acceptanceExpiresAt: 'asc' },
    take: 100,
  });

  let expiredCount = 0;
  for (const candidate of candidates) {
    const expired = await database.$transaction(
      async (transaction): Promise<ExpiredOrderResult | null> => {
        await transaction.$queryRaw`
          SELECT "id" FROM "DeliveryOrder"
          WHERE "id" = ${candidate.id}::uuid
          FOR UPDATE
        `;
        const order = await transaction.deliveryOrder.findUnique({
          where: { id: candidate.id },
          include: {
            merchant: {
              select: {
                memberships: {
                  where: {
                    active: true,
                    role: { in: ['OWNER', 'MANAGER'] },
                  },
                  select: { userId: true },
                },
              },
            },
          },
        });
        if (
          !order ||
          order.status !== 'SEARCHING_COURIER' ||
          order.courierId !== null ||
          !order.acceptanceExpiresAt ||
          order.acceptanceExpiresAt > now
        ) {
          return null;
        }

        const attempt = Math.max(1, order.dispatchAttemptCount);
        const final = attempt >= 2;
        const status = final
          ? ('NO_COURIER_AVAILABLE_FINAL' as const)
          : ('NO_COURIER_AVAILABLE' as const);
        const updated = await transaction.deliveryOrder.updateMany({
          where: {
            id: order.id,
            status: 'SEARCHING_COURIER',
            courierId: null,
            version: order.version,
            acceptanceExpiresAt: { lte: now },
          },
          data: {
            status,
            acceptanceExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return null;

        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'COURIER_SEARCH_EXPIRED',
            fromStatus: 'SEARCHING_COURIER',
            toStatus: status,
            actorType: 'SYSTEM',
            source: 'WORKER',
            reasonCode: final
              ? 'courier_search_final_timeout'
              : 'courier_search_timeout',
            merchantMessage: final
              ? 'انتهت محاولة البحث الثانية دون توفر مندوب. يمكنك إلغاء الطلب مجاناً أو التواصل مع الدعم.'
              : 'انتهت مهلة البحث دون توفر مندوب. يمكنك إعادة البحث مرة واحدة أو إلغاء الطلب مجاناً.',
            metadata: {
              attempt,
              expiredAt: order.acceptanceExpiresAt.toISOString(),
              processedAt: now.toISOString(),
              final,
            },
          },
        });

        const notifications: ExpiredOrderResult['notifications'] = [];
        for (const membership of order.merchant.memberships) {
          const type = final
            ? 'COURIER_SEARCH_FINAL_TIMEOUT'
            : 'COURIER_SEARCH_TIMEOUT';
          const notification = await transaction.notification.upsert({
            where: {
              deduplicationKey: `order:${order.id}:search-timeout:${attempt}:${membership.userId}`,
            },
            update: {},
            create: {
              recipientUserId: membership.userId,
              type,
              title: final
                ? 'لم يتوفر مندوب بعد محاولتين'
                : 'لم يتوفر مندوب خلال المهلة',
              body: final
                ? `لم يتوفر مندوب للطلب ${order.orderNumber} بعد محاولتين. يمكنك إلغاء الطلب مجاناً أو التواصل مع الدعم.`
                : `لم يتوفر مندوب للطلب ${order.orderNumber}. يمكنك إعادة البحث مرة واحدة أو إلغاء الطلب مجاناً.`,
              relatedEntityType: 'DeliveryOrder',
              relatedEntityId: order.id,
              deepLink: `/orders/${order.id}`,
              deduplicationKey: `order:${order.id}:search-timeout:${attempt}:${membership.userId}`,
              metadata: { attempt, final },
            },
          });
          notifications.push({
            id: notification.id,
            userId: membership.userId,
            type,
          });
        }

        await transaction.auditLog.create({
          data: {
            action: 'order.courier_search_expired',
            entityType: 'DeliveryOrder',
            entityId: order.id,
            before: {
              status: order.status,
              version: order.version,
              acceptanceExpiresAt: order.acceptanceExpiresAt,
            } as Prisma.InputJsonValue,
            after: {
              status,
              version: order.version + 1,
              acceptanceExpiresAt: null,
            } as Prisma.InputJsonValue,
            metadata: { attempt, final },
          },
        });
        return {
          orderId: order.id,
          merchantId: order.merchantId,
          serviceZoneId: order.serviceZoneId,
          status,
          version: order.version + 1,
          attempt,
          notifications,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );

    if (!expired) continue;
    expiredCount += 1;
    await publish?.(
      `service-zone:${expired.serviceZoneId}`,
      'marketplace.order.removed',
      {
        orderId: expired.orderId,
        reason: 'acceptance_timeout',
        status: expired.status,
        version: expired.version,
        attempt: expired.attempt,
      },
    );
    await publish?.(`merchant:${expired.merchantId}`, 'order.updated', {
      orderId: expired.orderId,
      status: expired.status,
      version: expired.version,
      dispatchAttemptCount: expired.attempt,
    });
    for (const notification of expired.notifications) {
      await publish?.(`user:${notification.userId}`, 'notification.created', {
        notificationId: notification.id,
        notificationType: notification.type,
      });
    }
  }
  return expiredCount;
}
