import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type {
  OrderCompletionSource,
  OrderEventSource,
  OrderStatus,
  Prisma,
  PrismaClient,
  UserRole,
} from '@wasel/database';

import {
  operationsTimezone,
  weeklySettlementBounds,
} from '../finance/finance-domain.js';
import { refreshSettlementProjection } from '../finance/settlement-projection.js';
import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class OrderFinalizationService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  public async finalize(
    orderId: string,
    input: {
      expectedStatuses: readonly OrderStatus[];
      completionSource: OrderCompletionSource;
      actorId?: string;
      actorRole?: UserRole;
      eventSource: OrderEventSource;
    },
  ) {
    return this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "DeliveryOrder"
          WHERE "id" = ${orderId}::uuid
          FOR UPDATE
        `;
        return this.finalizeInTransaction(transaction, orderId, input);
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async finalizeInTransaction(
    transaction: Transaction,
    orderId: string,
    input: {
      expectedStatuses: readonly OrderStatus[];
      completionSource: OrderCompletionSource;
      actorId?: string;
      actorRole?: UserRole;
      eventSource: OrderEventSource;
    },
  ) {
    const order = await transaction.deliveryOrder.findUnique({
      where: { id: orderId },
      include: {
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
    if (!order || !order.courierId || !order.courier) {
      throw new ConflictException(
        'A courier order is required for completion.',
      );
    }
    if (!input.expectedStatuses.includes(order.status)) {
      if (order.financialFinalizedAt) return order;
      throw new ConflictException('The order is not eligible for completion.');
    }
    if (order.financialFinalizedAt) return order;

    const finalizedAt = new Date();
    const completed = await transaction.deliveryOrder.updateMany({
      where: {
        id: order.id,
        status: order.status,
        version: order.version,
        financialFinalizedAt: null,
      },
      data: {
        status: 'COMPLETED',
        financialFinalizedAt: finalizedAt,
        completedAt: finalizedAt,
        completionSource: input.completionSource,
        version: { increment: 1 },
      },
    });
    if (completed.count !== 1) {
      throw new ConflictException('The order was completed concurrently.');
    }
    await transaction.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'ORDER_COMPLETED',
        fromStatus: order.status,
        toStatus: 'COMPLETED',
        actorType: input.actorId ? 'USER' : 'SYSTEM',
        actorId: input.actorId,
        actorRole: input.actorRole,
        source: input.eventSource,
        reasonCode: input.completionSource.toLowerCase(),
        merchantMessage:
          'اكتمل الطلب مالياً بعد انتهاء نافذة الاعتراض أو القرار الإداري.',
      },
    });
    const ledgerEntry = await transaction.courierLedgerEntry.create({
      data: {
        courierId: order.courierId,
        orderId: order.id,
        type: 'COMMISSION_DUE',
        amountMinor: order.platformCommissionMinor,
        currency: order.currency,
        sourceKey: `order:${order.id}:commission`,
        createdById: input.actorId,
        reason: 'Commission finalized after Phase 4 delivery resolution.',
        occurredAt: finalizedAt,
      },
    });
    const setting = await transaction.platformFinancialSetting.findFirstOrThrow(
      {
        where: { effectiveFrom: { lte: finalizedAt } },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      },
    );
    const bounds = weeklySettlementBounds(
      finalizedAt,
      setting.gracePeriodDays,
      setting.operationsTimezone || operationsTimezone,
    );
    const settlement = await transaction.settlementPeriod.upsert({
      where: {
        courierId_periodStart_periodEnd: {
          courierId: order.courierId,
          periodStart: bounds.periodStart,
          periodEnd: bounds.periodEnd,
        },
      },
      update: {},
      create: {
        courierId: order.courierId,
        ...bounds,
        currency: order.currency,
      },
    });
    await transaction.settlementLine.create({
      data: {
        settlementPeriodId: settlement.id,
        ledgerEntryId: ledgerEntry.id,
        amountMinor: ledgerEntry.amountMinor,
      },
    });
    await refreshSettlementProjection(transaction, settlement.id, finalizedAt);
    await transaction.courierProfile.update({
      where: { id: order.courierId },
      data: { completedOrdersCount: { increment: 1 } },
    });
    const recipients = [
      ...order.merchant.memberships.map((membership) => membership.userId),
      order.courier.userId,
    ];
    for (const userId of recipients) {
      await this.notifications.create(transaction, {
        recipientUserId: userId,
        type: 'ORDER_COMPLETED',
        title: 'اكتمل الطلب',
        body: `اكتمل الطلب ${order.orderNumber} وأضيفت العمولة مرة واحدة.`,
        relatedEntityType: 'DeliveryOrder',
        relatedEntityId: order.id,
        deepLink: `/orders/${order.id}`,
        deduplicationKey: `order:${order.id}:completed:${userId}`,
      });
    }
    await writeAudit(transaction, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'order.financially_completed_phase4',
      entityType: 'DeliveryOrder',
      entityId: order.id,
      metadata: {
        completionSource: input.completionSource,
        ledgerEntryId: ledgerEntry.id,
        settlementPeriodId: settlement.id,
      },
    });
    this.realtime.publish(`merchant:${order.merchantId}`, 'order.updated', {
      orderId: order.id,
      status: 'COMPLETED',
      version: order.version + 1,
    });
    this.realtime.publish(`courier:${order.courierId}`, 'order.updated', {
      orderId: order.id,
      status: 'COMPLETED',
      version: order.version + 1,
    });
    return transaction.deliveryOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
  }
}
