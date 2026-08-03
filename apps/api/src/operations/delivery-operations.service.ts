import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DeliveryDisputeReason,
  DeliveryDisputeStatus,
  Prisma,
  PrismaClient,
  ReturnCondition,
} from '@wasel/database';

import { databaseRoleByRole } from '../infrastructure/request.js';
import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { merchantContext } from '../merchant/merchant-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrderFinalizationService } from '../orders/order-finalization.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { requestFingerprint } from '../orders/order-domain.js';
import { disputeWindowIsActive } from './phase-four-domain.js';

type Actor = {
  userId: string;
  role:
    | 'merchant_owner'
    | 'merchant_manager'
    | 'courier'
    | 'operations_admin'
    | 'super_admin';
};

@Injectable()
export class DeliveryOperationsService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(OrderFinalizationService)
    private readonly finalization: OrderFinalizationService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  public async merchantDispute(
    actor: Actor,
    orderId: string,
    input: {
      version: number;
      reason: DeliveryDisputeReason;
      note?: string;
    },
  ) {
    const membership = await merchantContext(this.database, actor.userId);
    if (!['OWNER', 'MANAGER'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only an owner or manager may dispute delivery.',
      );
    }
    return this.database.$transaction(
      async (transaction) => {
        await this.lockOrder(transaction, orderId);
        const order = await transaction.deliveryOrder.findFirst({
          where: { id: orderId, merchantId: membership.merchantId },
          include: { courier: { select: { userId: true } } },
        });
        if (!order) throw new NotFoundException('Order was not found.');
        if (
          order.version !== input.version ||
          !order.courierId ||
          !order.courier ||
          !disputeWindowIsActive({
            status: order.status,
            deadline: order.deliveryDisputeDeadlineAt,
            now: new Date(),
            hasDispute: false,
          })
        ) {
          throw new ConflictException(
            'The active delivery dispute window is unavailable.',
          );
        }
        const dispute = await transaction.deliveryDispute.create({
          data: {
            orderId: order.id,
            merchantId: order.merchantId,
            courierId: order.courierId,
            merchantReason: input.reason,
            merchantNote: input.note,
            createdById: actor.userId,
          },
        });
        await transaction.deliveryOrder.update({
          where: { id: order.id },
          data: { status: 'DELIVERY_DISPUTED', version: { increment: 1 } },
        });
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'DELIVERY_DISPUTE_CREATED',
            fromStatus: 'DELIVERED',
            toStatus: 'DELIVERY_DISPUTED',
            actorId: actor.userId,
            actorRole: databaseRoleByRole[actor.role],
            actorType: 'USER',
            source: 'MERCHANT_WEB',
            reasonCode: input.reason.toLowerCase(),
            merchantMessage: 'تم فتح اعتراض على التسليم وإيقاف الإكمال المالي.',
          },
        });
        await this.notifications.create(transaction, {
          recipientUserId: order.courier.userId,
          type: 'DELIVERY_DISPUTE_CREATED',
          title: 'اعتراض على التسليم',
          body: `فتح التاجر اعتراضاً على الطلب ${order.orderNumber}.`,
          relatedEntityType: 'DeliveryDispute',
          relatedEntityId: dispute.id,
          deepLink: `/orders/${order.id}`,
          deduplicationKey: `dispute:${dispute.id}:courier`,
        });
        await this.notifyAdminRoles(transaction, {
          type: 'DELIVERY_DISPUTE_CREATED',
          title: 'اعتراض توصيل جديد',
          body: `الطلب ${order.orderNumber} يحتاج مراجعة العمليات.`,
          relatedEntityId: dispute.id,
          deepLink: `/delivery-disputes/${dispute.id}`,
          key: `dispute:${dispute.id}:admin`,
          roles: ['OPERATIONS_ADMIN', 'SUPER_ADMIN'],
        });
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: 'delivery_dispute.created',
          entityType: 'DeliveryDispute',
          entityId: dispute.id,
          metadata: { orderId: order.id, reason: input.reason },
        });
        this.publishOrder(order.merchantId, order.courierId, order.id, {
          status: 'DELIVERY_DISPUTED',
          version: order.version + 1,
        });
        return dispute;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async merchantDisputeDetail(userId: string, orderId: string) {
    const membership = await merchantContext(this.database, userId);
    const dispute = await this.database.deliveryDispute.findFirst({
      where: { orderId, merchantId: membership.merchantId },
      include: { order: true },
    });
    if (!dispute)
      throw new NotFoundException('Delivery dispute was not found.');
    return dispute;
  }

  public async courierDisputeDetail(userId: string, orderId: string) {
    const courier = await this.courierForUser(userId);
    const dispute = await this.database.deliveryDispute.findFirst({
      where: { orderId, courierId: courier.id },
      include: { order: true },
    });
    if (!dispute)
      throw new NotFoundException('Delivery dispute was not found.');
    return dispute;
  }

  public async courierRespond(
    actor: Actor,
    orderId: string,
    input: { version: number; response: string; paperProofAvailable: boolean },
  ) {
    const courier = await this.courierForUser(actor.userId);
    const dispute = await this.database.deliveryDispute.findFirst({
      where: { orderId, courierId: courier.id },
    });
    if (!dispute)
      throw new NotFoundException('Delivery dispute was not found.');
    const updated = await this.database.$transaction(async (transaction) => {
      const result = await transaction.deliveryDispute.updateMany({
        where: {
          id: dispute.id,
          courierId: courier.id,
          version: input.version,
          status: 'OPEN',
          courierRespondedAt: null,
        },
        data: {
          status: 'COURIER_RESPONDED',
          courierResponse: input.response,
          paperProofAvailable: input.paperProofAvailable,
          courierRespondedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'This dispute already has a response or changed.',
        );
      }
      await transaction.orderEvent.create({
        data: {
          orderId,
          eventType: 'DELIVERY_DISPUTE_COURIER_RESPONDED',
          fromStatus: 'DELIVERY_DISPUTED',
          toStatus: 'DELIVERY_DISPUTED',
          actorId: actor.userId,
          actorRole: 'COURIER',
          actorType: 'USER',
          source: 'COURIER_MOBILE',
          reasonCode: 'courier_response',
        },
      });
      await writeAudit(transaction, {
        actorId: actor.userId,
        actorRole: 'COURIER',
        action: 'delivery_dispute.courier_responded',
        entityType: 'DeliveryDispute',
        entityId: dispute.id,
        metadata: { paperProofAvailable: input.paperProofAvailable },
      });
      return transaction.deliveryDispute.findUniqueOrThrow({
        where: { id: dispute.id },
      });
    });
    this.realtime.publish('admin:operations_admin', 'dispute.updated', {
      disputeId: dispute.id,
      status: 'COURIER_RESPONDED',
      version: updated.version,
    });
    return updated;
  }

  public adminDisputes(input: {
    status?: DeliveryDisputeStatus;
    merchantId?: string;
    courierId?: string;
    reason?: DeliveryDisputeReason;
    overdueOnly?: boolean;
  }) {
    return this.database.deliveryDispute.findMany({
      where: {
        status: input.status,
        merchantId: input.merchantId,
        courierId: input.courierId,
        merchantReason: input.reason,
        ...(input.overdueOnly
          ? {
              status: { in: ['OPEN', 'COURIER_RESPONDED'] },
              createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
            }
          : {}),
      },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
        merchant: { select: { displayName: true } },
        courier: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async adminDispute(disputeId: string) {
    const dispute = await this.database.deliveryDispute.findUnique({
      where: { id: disputeId },
      include: {
        order: { include: { events: { orderBy: { createdAt: 'asc' } } } },
        merchant: true,
        courier: { include: { user: { select: { phone: true } } } },
        createdBy: { select: { displayName: true, role: true } },
        resolvedBy: { select: { displayName: true, role: true } },
      },
    });
    if (!dispute)
      throw new NotFoundException('Delivery dispute was not found.');
    return dispute;
  }

  public async resolveDispute(
    actor: Actor,
    disputeId: string,
    input: {
      version: number;
      resolution:
        'CONFIRM_DELIVERY' | 'CONFIRM_NOT_DELIVERED' | 'REQUIRE_RETURN';
      note: string;
    },
  ) {
    return this.database.$transaction(
      async (transaction) => {
        const dispute = await transaction.deliveryDispute.findUnique({
          where: { id: disputeId },
          include: {
            order: {
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
                courier: { select: { userId: true } },
              },
            },
          },
        });
        if (!dispute)
          throw new NotFoundException('Delivery dispute was not found.');
        if (
          !['OPEN', 'COURIER_RESPONDED'].includes(dispute.status) ||
          dispute.version !== input.version
        ) {
          throw new ConflictException(
            'The dispute is already resolved or changed.',
          );
        }
        const statusByResolution = {
          CONFIRM_DELIVERY: 'RESOLVED_DELIVERY_CONFIRMED',
          CONFIRM_NOT_DELIVERED: 'RESOLVED_NOT_DELIVERED',
          REQUIRE_RETURN: 'RESOLVED_RETURN_REQUIRED',
        } as const;
        const targetByResolution = {
          CONFIRM_DELIVERY: 'DELIVERY_DISPUTED',
          CONFIRM_NOT_DELIVERED: 'DELIVERY_FAILED',
          REQUIRE_RETURN: 'RETURNING_TO_STORE',
        } as const;
        const resolvedAt = new Date();
        await transaction.deliveryDispute.update({
          where: { id: dispute.id },
          data: {
            status: statusByResolution[input.resolution],
            resolutionNote: input.note,
            resolvedById: actor.userId,
            resolvedAt,
            version: { increment: 1 },
          },
        });
        await transaction.orderEvent.create({
          data: {
            orderId: dispute.orderId,
            eventType: 'DELIVERY_DISPUTE_RESOLVED',
            fromStatus: 'DELIVERY_DISPUTED',
            toStatus: targetByResolution[input.resolution],
            actorId: actor.userId,
            actorRole: databaseRoleByRole[actor.role],
            actorType: 'USER',
            source: 'ADMIN_WEB',
            reasonCode: input.resolution.toLowerCase(),
            internalMessage: input.note,
          },
        });
        if (input.resolution === 'CONFIRM_DELIVERY') {
          await this.finalization.finalizeInTransaction(
            transaction,
            dispute.orderId,
            {
              expectedStatuses: ['DELIVERY_DISPUTED'],
              completionSource: 'ADMIN_CONFIRMED_DELIVERY',
              actorId: actor.userId,
              actorRole: databaseRoleByRole[actor.role],
              eventSource: 'ADMIN_WEB',
            },
          );
        } else {
          await transaction.deliveryOrder.update({
            where: { id: dispute.orderId },
            data: {
              status: targetByResolution[input.resolution],
              ...(input.resolution === 'CONFIRM_NOT_DELIVERED'
                ? {
                    deliveryFailureReason: 'OTHER',
                    deliveryFailureNote: input.note,
                  }
                : {}),
              version: { increment: 1 },
            },
          });
        }
        const users = [
          ...dispute.order.merchant.memberships.map((item) => item.userId),
          ...(dispute.order.courier ? [dispute.order.courier.userId] : []),
        ];
        for (const userId of users) {
          await this.notifications.create(transaction, {
            recipientUserId: userId,
            type: 'DELIVERY_DISPUTE_RESOLVED',
            title: 'تم حسم اعتراض التسليم',
            body: `تم حسم اعتراض الطلب ${dispute.order.orderNumber}.`,
            relatedEntityType: 'DeliveryDispute',
            relatedEntityId: dispute.id,
            deepLink: `/orders/${dispute.orderId}`,
            deduplicationKey: `dispute:${dispute.id}:resolved:${userId}`,
          });
        }
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: 'delivery_dispute.resolved',
          entityType: 'DeliveryDispute',
          entityId: dispute.id,
          metadata: { resolution: input.resolution, note: input.note },
        });
        return transaction.deliveryDispute.findUniqueOrThrow({
          where: { id: dispute.id },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async confirmReturn(
    actor: Actor,
    orderId: string,
    input: { version: number; condition: ReturnCondition; note?: string },
    idempotencyKey: string,
    adminReason?: string,
  ) {
    const isAdmin = ['operations_admin', 'super_admin'].includes(actor.role);
    const membership = isAdmin
      ? undefined
      : await merchantContext(this.database, actor.userId);
    if (membership && !['OWNER', 'MANAGER'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only an owner or manager may confirm a return.',
      );
    }
    const scope = `${isAdmin ? 'admin' : 'merchant'}:return-confirm:${orderId}`;
    const fingerprint = requestFingerprint({ ...input, adminReason });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) {
      return this.database.deliveryOrder.findUniqueOrThrow({
        where: { id: replay },
      });
    }
    return this.database.$transaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await this.lockOrder(transaction, orderId);
        const order = await transaction.deliveryOrder.findFirst({
          where: {
            id: orderId,
            ...(membership ? { merchantId: membership.merchantId } : {}),
          },
        });
        if (!order) throw new NotFoundException('Order was not found.');
        if (
          order.status !== 'RETURN_AWAITING_MERCHANT_CONFIRMATION' ||
          order.version !== input.version
        ) {
          throw new ConflictException(
            'The return is not awaiting confirmation.',
          );
        }
        if (isAdmin) {
          const setting =
            await transaction.platformOperationalSetting.findFirstOrThrow({
              where: { effectiveFrom: { lte: new Date() } },
              orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
            });
          const staleAt = new Date(
            (order.returnReportedAt?.getTime() ?? Date.now()) +
              setting.returnConfirmationTimeoutHours * 60 * 60 * 1_000,
          );
          if (staleAt > new Date() || !adminReason) {
            throw new ConflictException(
              'Admin override requires a stale return and an explicit reason.',
            );
          }
        }
        const confirmedAt = new Date();
        await transaction.deliveryOrder.update({
          where: { id: order.id },
          data: {
            status: 'RETURNED',
            returnConfirmedAt: confirmedAt,
            returnConfirmedById: actor.userId,
            returnCondition: input.condition,
            returnConfirmationNote: input.note,
            version: { increment: 1 },
          },
        });
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: isAdmin ? 'RETURN_ADMIN_OVERRIDE' : 'RETURN_CONFIRMED',
            fromStatus: 'RETURN_AWAITING_MERCHANT_CONFIRMATION',
            toStatus: 'RETURNED',
            actorId: actor.userId,
            actorRole: databaseRoleByRole[actor.role],
            actorType: 'USER',
            source: isAdmin ? 'ADMIN_WEB' : 'MERCHANT_WEB',
            reasonCode: isAdmin
              ? 'stale_return_override'
              : input.condition.toLowerCase(),
            internalMessage: adminReason ?? input.note,
          },
        });
        const finalized = await this.finalization.finalizeInTransaction(
          transaction,
          order.id,
          {
            expectedStatuses: ['RETURNED'],
            completionSource: isAdmin
              ? 'ADMIN_RETURN_OVERRIDE'
              : 'MERCHANT_CONFIRMED_RETURN',
            actorId: actor.userId,
            actorRole: databaseRoleByRole[actor.role],
            eventSource: isAdmin ? 'ADMIN_WEB' : 'MERCHANT_WEB',
          },
        );
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: isAdmin
            ? 'return.admin_override'
            : 'return.merchant_confirmed',
          entityType: 'DeliveryOrder',
          entityId: order.id,
          metadata: { condition: input.condition, adminReason },
        });
        await transaction.idempotencyRecord.update({
          where: { scope_key: { scope, key: idempotencyKey } },
          data: {
            status: 'COMPLETED',
            responseCode: 200,
            responseBody: { entityId: order.id },
          },
        });
        return finalized;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async claimIdempotency(
    transaction: Prisma.TransactionClient,
    scope: string,
    key: string,
    requestHash: string,
  ) {
    const existing = await transaction.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'The idempotency key was reused with different data.',
        );
      }
      throw new ConflictException('The request is already processing.');
    }
    await transaction.idempotencyRecord.create({
      data: {
        scope,
        key,
        requestHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      },
    });
  }

  private async idempotencyReplay(
    scope: string,
    key: string,
    requestHash: string,
  ) {
    const record = await this.database.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!record) return undefined;
    if (record.requestHash !== requestHash) {
      throw new ConflictException(
        'The idempotency key was reused with different data.',
      );
    }
    const body = record.responseBody as { entityId?: string } | null;
    if (record.status === 'COMPLETED' && body?.entityId) return body.entityId;
    throw new ConflictException('The request is already processing.');
  }

  private async courierForUser(userId: string) {
    const courier = await this.database.courierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!courier) throw new NotFoundException('Courier profile was not found.');
    return courier;
  }

  private async lockOrder(
    transaction: Prisma.TransactionClient,
    orderId: string,
  ) {
    await transaction.$queryRaw`
      SELECT "id" FROM "DeliveryOrder"
      WHERE "id" = ${orderId}::uuid
      FOR UPDATE
    `;
  }

  private async notifyAdminRoles(
    transaction: Prisma.TransactionClient,
    input: {
      type: string;
      title: string;
      body: string;
      relatedEntityId: string;
      deepLink: string;
      key: string;
      roles: Array<'OPERATIONS_ADMIN' | 'SUPER_ADMIN'>;
    },
  ) {
    const admins = await transaction.user.findMany({
      where: { role: { in: input.roles }, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notifications.create(transaction, {
        recipientUserId: admin.id,
        type: input.type,
        title: input.title,
        body: input.body,
        relatedEntityType: 'DeliveryDispute',
        relatedEntityId: input.relatedEntityId,
        deepLink: input.deepLink,
        deduplicationKey: `${input.key}:${admin.id}`,
      });
    }
  }

  private publishOrder(
    merchantId: string,
    courierId: string,
    orderId: string,
    payload: { status: string; version: number },
  ) {
    this.realtime.publish(`merchant:${merchantId}`, 'order.updated', {
      orderId,
      ...payload,
    });
    this.realtime.publish(`courier:${courierId}`, 'order.updated', {
      orderId,
      ...payload,
    });
  }
}
