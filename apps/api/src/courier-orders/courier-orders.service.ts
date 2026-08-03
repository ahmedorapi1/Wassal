import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@wasel/contracts';
import type {
  OrderEventType,
  OrderStatus,
  DeliveryFailureReason,
  Prisma,
  PrismaClient,
} from '@wasel/database';

import {
  courierOperationalEligibility,
  eligibleServiceZoneIds,
} from '../courier/courier-policy.js';
import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { databaseRoleByRole } from '../infrastructure/request.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { deliveryDisputeDeadline } from '../operations/phase-four-domain.js';
import {
  acceptanceDeadline,
  acceptanceIsExpired,
  canTransitionInPhaseThree,
  requestFingerprint,
} from '../orders/order-domain.js';
import { courierFinancialDetails } from './courier-order-presentation.js';

type Transaction = Prisma.TransactionClient;
type CourierActor = { userId: string; role: Role };

const activeCourierStatuses: OrderStatus[] = [
  'COURIER_ASSIGNED',
  'COURIER_ARRIVING_PICKUP',
  'AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DROPOFF',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNING_TO_STORE',
  'RETURN_AWAITING_MERCHANT_CONFIRMATION',
  'RETURNED',
];

const lifecycle = {
  'arriving-pickup': {
    from: ['COURIER_ASSIGNED'],
    to: 'COURIER_ARRIVING_PICKUP',
    eventType: 'COURIER_ARRIVING_PICKUP',
  },
  'arrived-pickup': {
    from: ['COURIER_ARRIVING_PICKUP'],
    to: 'AT_PICKUP',
    eventType: 'COURIER_ARRIVED_PICKUP',
  },
  'picked-up': {
    from: ['AT_PICKUP'],
    to: 'PICKED_UP',
    eventType: 'ORDER_PICKED_UP',
  },
  'in-transit': {
    from: ['PICKED_UP'],
    to: 'IN_TRANSIT',
    eventType: 'ORDER_IN_TRANSIT',
  },
  'arrived-dropoff': {
    from: ['IN_TRANSIT'],
    to: 'AT_DROPOFF',
    eventType: 'COURIER_ARRIVED_DROPOFF',
  },
  delivered: {
    from: ['AT_DROPOFF'],
    to: 'DELIVERED',
    eventType: 'ORDER_DELIVERED',
  },
  'delivery-failed': {
    from: ['PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'],
    to: 'DELIVERY_FAILED',
    eventType: 'DELIVERY_FAILED',
  },
  'returning-to-store': {
    from: ['DELIVERY_FAILED'],
    to: 'RETURNING_TO_STORE',
    eventType: 'RETURNING_TO_STORE',
  },
  returned: {
    from: ['RETURNING_TO_STORE'],
    to: 'RETURN_AWAITING_MERCHANT_CONFIRMATION',
    eventType: 'RETURN_AWAITING_MERCHANT_CONFIRMATION',
  },
} as const satisfies Record<
  string,
  {
    from: readonly OrderStatus[];
    to: OrderStatus;
    eventType: OrderEventType;
  }
>;

export type CourierLifecycleAction = keyof typeof lifecycle;

@Injectable()
export class CourierOrdersService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  public async available(
    userId: string,
    input: { page: number; pageSize: number },
  ) {
    const courier = await this.eligibleCourier(this.database, userId);
    const zoneIds = eligibleServiceZoneIds(courier.serviceZones);
    const where: Prisma.DeliveryOrderWhereInput = {
      status: 'SEARCHING_COURIER',
      courierId: null,
      acceptanceExpiresAt: { gt: new Date() },
      serviceZoneId: { in: zoneIds },
    };
    const [orders, total] = await Promise.all([
      this.database.deliveryOrder.findMany({
        where,
        include: {
          store: { select: { name: true, area: true } },
          serviceZone: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.deliveryOrder.count({ where }),
    ]);
    return {
      items: orders.map((order) => this.safeMarketplaceOrder(order)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  public async availableOrder(userId: string, orderId: string) {
    const courier = await this.eligibleCourier(this.database, userId);
    const order = await this.database.deliveryOrder.findFirst({
      where: {
        id: orderId,
        status: 'SEARCHING_COURIER',
        courierId: null,
        acceptanceExpiresAt: { gt: new Date() },
        serviceZone: {
          status: 'ACTIVE',
          courierMemberships: {
            some: { courierId: courier.id, active: true },
          },
        },
      },
      include: {
        store: { select: { name: true, area: true } },
        serviceZone: { select: { name: true } },
      },
    });
    if (!order) throw new NotFoundException('Available order was not found.');
    return this.safeMarketplaceOrder(order);
  }

  public async accept(
    actor: CourierActor,
    orderId: string,
    version: number,
    idempotencyKey: string,
  ) {
    const courier = await this.eligibleCourier(this.database, actor.userId);
    const scope = `courier-order:accept:${courier.id}:${orderId}`;
    const fingerprint = requestFingerprint({ orderId, version });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.assignedOrder(actor.userId, replay);

    try {
      const acceptedId = await this.serializableTransaction(
        async (transaction) => {
          await this.claimIdempotency(
            transaction,
            scope,
            idempotencyKey,
            fingerprint,
          );
          await transaction.$queryRaw`
            SELECT "id"
            FROM "DeliveryOrder"
            WHERE "id" = ${orderId}::uuid
            FOR UPDATE
          `;
          const order = await transaction.deliveryOrder.findUnique({
            where: { id: orderId },
          });
          if (!order) throw new NotFoundException('Order was not found.');
          if (
            order.status !== 'SEARCHING_COURIER' ||
            order.courierId !== null
          ) {
            throw new ConflictException(
              'The order has already been accepted by another courier.',
            );
          }
          const acceptedAt = new Date();
          if (acceptanceIsExpired(order.acceptanceExpiresAt, acceptedAt)) {
            throw new ConflictException({
              code: 'COURIER_ACCEPTANCE_EXPIRED',
              message: 'انتهت مدة قبول هذا الطلب.',
            });
          }
          if (order.version !== version) {
            throw new ConflictException(
              'The order changed before acceptance. Reload and retry.',
            );
          }
          await this.assertZoneEligibility(
            transaction,
            courier.id,
            order.serviceZoneId,
          );
          const updated = await transaction.deliveryOrder.updateMany({
            where: {
              id: order.id,
              status: 'SEARCHING_COURIER',
              courierId: null,
              version,
              acceptanceExpiresAt: { gt: acceptedAt },
            },
            data: {
              courierId: courier.id,
              status: 'COURIER_ASSIGNED',
              acceptanceExpiresAt: null,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException(
              'The order has already been accepted by another courier.',
            );
          }
          await transaction.orderEvent.create({
            data: {
              orderId: order.id,
              eventType: 'COURIER_ACCEPTED',
              fromStatus: 'SEARCHING_COURIER',
              toStatus: 'COURIER_ASSIGNED',
              actorType: 'USER',
              actorId: actor.userId,
              actorRole: databaseRoleByRole[actor.role],
              source: 'COURIER_MOBILE',
              merchantMessage: 'تم قبول الطلب بواسطة مندوب.',
              metadata: {
                attempt: order.dispatchAttemptCount,
                acceptedAt: acceptedAt.toISOString(),
              },
            },
          });
          await writeAudit(transaction, {
            actorId: actor.userId,
            actorRole: databaseRoleByRole[actor.role],
            action: 'courier_order.accepted',
            entityType: 'DeliveryOrder',
            entityId: order.id,
            metadata: { courierId: courier.id, version },
          });
          await this.completeIdempotency(
            transaction,
            scope,
            idempotencyKey,
            order.id,
            201,
          );
          return order.id;
        },
        { isolationLevel: 'Serializable' },
      );
      const accepted = await this.assignedOrder(actor.userId, acceptedId);
      this.realtime.publish(
        `service-zone:${accepted.serviceZoneId}`,
        'marketplace.order.removed',
        {
          orderId: accepted.id,
          reason: 'accepted',
          version: accepted.version,
        },
      );
      this.realtime.publish(
        `merchant:${accepted.merchantId}`,
        'order.updated',
        {
          orderId: accepted.id,
          status: accepted.status,
          version: accepted.version,
        },
      );
      return accepted;
    } catch (error) {
      const replayAfterRace = await this.idempotencyReplayIfCompleted(
        scope,
        idempotencyKey,
        fingerprint,
      );
      if (replayAfterRace) {
        return this.assignedOrder(actor.userId, replayAfterRace);
      }
      const current = await this.database.deliveryOrder.findUnique({
        where: { id: orderId },
        select: {
          courierId: true,
          status: true,
          acceptanceExpiresAt: true,
        },
      });
      if (
        current &&
        (current.status === 'NO_COURIER_AVAILABLE' ||
          current.status === 'NO_COURIER_AVAILABLE_FINAL' ||
          (current.status === 'SEARCHING_COURIER' &&
            acceptanceIsExpired(current.acceptanceExpiresAt)))
      ) {
        throw new ConflictException({
          code: 'COURIER_ACCEPTANCE_EXPIRED',
          message: 'انتهت مدة قبول هذا الطلب.',
        });
      }
      if (
        current &&
        (current.courierId !== null || current.status !== 'SEARCHING_COURIER')
      ) {
        throw new ConflictException(
          'The order has already been accepted by another courier.',
        );
      }
      throw error;
    }
  }

  public async current(userId: string) {
    const courier = await this.courierForUser(this.database, userId);
    const order = await this.database.deliveryOrder.findFirst({
      where: { courierId: courier.id, status: { in: activeCourierStatuses } },
      include: this.assignedOrderInclude(),
      orderBy: { updatedAt: 'desc' },
    });
    return order ? this.fullCourierOrder(order) : null;
  }

  public async history(
    userId: string,
    input: { page: number; pageSize: number },
  ) {
    const courier = await this.courierForUser(this.database, userId);
    const where: Prisma.DeliveryOrderWhereInput = {
      OR: [
        {
          courierId: courier.id,
          status: { in: ['COMPLETED', 'CANCELLED'] },
        },
        {
          events: {
            some: {
              eventType: 'COURIER_CANCELLED',
              actorId: userId,
            },
          },
        },
      ],
    };
    const [orders, total] = await Promise.all([
      this.database.deliveryOrder.findMany({
        where,
        include: this.assignedOrderInclude(),
        orderBy: { updatedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.deliveryOrder.count({ where }),
    ]);
    return {
      items: orders.map((order) => this.fullCourierOrder(order)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  public async transition(
    actor: CourierActor,
    orderId: string,
    action: CourierLifecycleAction,
    input: {
      version: number;
      note?: string;
      failureReason?: DeliveryFailureReason;
    },
    idempotencyKey: string,
  ) {
    const command = lifecycle[action];
    const courier = await this.courierForUser(this.database, actor.userId);
    const scope = `courier-order:${action}:${orderId}`;
    const fingerprint = requestFingerprint({ orderId, action, ...input });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.assignedOrder(actor.userId, replay);

    const transitionedId = await this.serializableTransaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await transaction.$queryRaw`
          SELECT "id"
          FROM "DeliveryOrder"
          WHERE "id" = ${orderId}::uuid
          FOR UPDATE
        `;
        const persistedOrder = await transaction.deliveryOrder.findUnique({
          where: { id: orderId },
        });
        if (!persistedOrder)
          throw new NotFoundException('Order was not found.');
        let order = persistedOrder;
        if (order.courierId !== courier.id) {
          throw new ForbiddenException(
            'Only the assigned courier may update this order.',
          );
        }
        if (
          order.version !== input.version ||
          !(command.from as readonly OrderStatus[]).includes(order.status)
        ) {
          throw new ConflictException(
            'The order changed or this transition is no longer allowed.',
          );
        }
        if (!canTransitionInPhaseThree(order.status, command.to)) {
          throw new ConflictException('The order transition is not allowed.');
        }
        const updated = await transaction.deliveryOrder.updateMany({
          where: {
            id: order.id,
            courierId: courier.id,
            version: input.version,
            status: { in: [...command.from] },
          },
          data: {
            status: command.to,
            ...(command.to === 'DELIVERED'
              ? await this.deliveryWindow(transaction, input.note)
              : {}),
            ...(command.to === 'DELIVERY_FAILED'
              ? {
                  deliveryFailureReason: input.failureReason,
                  deliveryFailureNote: input.note,
                }
              : {}),
            ...(command.to === 'RETURN_AWAITING_MERCHANT_CONFIRMATION'
              ? { returnReportedAt: new Date() }
              : {}),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'The order changed before the transition committed.',
          );
        }
        await this.createLifecycleEvidence(
          transaction,
          order,
          command.to,
          command.eventType,
          actor,
        );
        order = { ...order, status: command.to, version: order.version + 1 };

        const merchantUsers = await transaction.merchantMembership.findMany({
          where: {
            merchantId: order.merchantId,
            active: true,
            role: { in: ['OWNER', 'MANAGER'] },
          },
          select: { userId: true },
        });
        for (const recipient of merchantUsers) {
          await this.notifications.create(transaction, {
            recipientUserId: recipient.userId,
            type: `ORDER_${command.to}`,
            title: 'تحديث حالة الطلب',
            body: this.merchantMessage(command.to),
            relatedEntityType: 'DeliveryOrder',
            relatedEntityId: order.id,
            deepLink: `/orders/${order.id}`,
            deduplicationKey: `order:${order.id}:${command.to}:${order.version + 1}:${recipient.userId}`,
          });
        }
        await this.completeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          order.id,
          200,
        );
        return order.id;
      },
      { isolationLevel: 'Serializable' },
    );
    const transitioned = await this.assignedOrder(actor.userId, transitionedId);
    this.realtime.publish(
      `merchant:${transitioned.merchantId}`,
      'order.updated',
      {
        orderId: transitioned.id,
        status: transitioned.status,
        version: transitioned.version,
      },
    );
    this.realtime.publish(`courier:${courier.id}`, 'order.updated', {
      orderId: transitioned.id,
      status: transitioned.status,
      version: transitioned.version,
    });
    return transitioned;
  }

  private async deliveryWindow(
    transaction: Transaction,
    note: string | undefined,
  ) {
    const now = new Date();
    const setting =
      await transaction.platformOperationalSetting.findFirstOrThrow({
        where: { effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      });
    return {
      deliveredAt: now,
      deliveryDisputeDeadlineAt: deliveryDisputeDeadline(
        now,
        setting.deliveryDisputeWindowHours,
      ),
      deliveryNote: note,
    };
  }

  public async cancelBeforePickup(
    actor: CourierActor,
    orderId: string,
    input: { version: number; reason: string },
    idempotencyKey: string,
  ) {
    const courier = await this.courierForUser(this.database, actor.userId);
    const scope = `courier-order:cancel:${courier.id}:${orderId}`;
    const fingerprint = requestFingerprint(input);
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.availableOrder(actor.userId, replay);

    const cancelledId = await this.serializableTransaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await transaction.$queryRaw`
          SELECT "id"
          FROM "DeliveryOrder"
          WHERE "id" = ${orderId}::uuid
          FOR UPDATE
        `;
        const order = await transaction.deliveryOrder.findUnique({
          where: { id: orderId },
        });
        if (!order) throw new NotFoundException('Order was not found.');
        const cancellable: OrderStatus[] = [
          'COURIER_ASSIGNED',
          'COURIER_ARRIVING_PICKUP',
          'AT_PICKUP',
        ];
        if (
          order.courierId !== courier.id ||
          order.version !== input.version ||
          !cancellable.includes(order.status)
        ) {
          throw new ConflictException(
            'Courier cancellation is allowed only before pickup on the current version.',
          );
        }
        const updated = await transaction.deliveryOrder.updateMany({
          where: {
            id: order.id,
            courierId: courier.id,
            status: { in: cancellable },
            version: input.version,
          },
          data: {
            courierId: null,
            status: 'SEARCHING_COURIER',
            acceptanceExpiresAt: acceptanceDeadline(),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'The order changed before cancellation committed.',
          );
        }
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'COURIER_CANCELLED',
            fromStatus: order.status,
            toStatus: 'SEARCHING_COURIER',
            actorType: 'USER',
            actorId: actor.userId,
            actorRole: databaseRoleByRole[actor.role],
            source: 'COURIER_MOBILE',
            reasonCode: 'courier_pre_pickup_cancelled',
            internalMessage: input.reason,
            merchantMessage: 'ألغى المندوب القبول ويجري البحث عن مندوب آخر.',
          },
        });
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: 'courier_order.cancelled_before_pickup',
          entityType: 'DeliveryOrder',
          entityId: order.id,
          metadata: { courierId: courier.id, reason: input.reason },
        });
        await this.completeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          order.id,
          200,
        );
        return order.id;
      },
      { isolationLevel: 'Serializable' },
    );
    const available = await this.availableOrder(actor.userId, cancelledId);
    const routing = await this.database.deliveryOrder.findUniqueOrThrow({
      where: { id: cancelledId },
      select: {
        merchantId: true,
        serviceZoneId: true,
        version: true,
        acceptanceExpiresAt: true,
      },
    });
    this.realtime.publish(
      `service-zone:${routing.serviceZoneId}`,
      'marketplace.order.available',
      {
        orderId: available.id,
        status: 'SEARCHING_COURIER',
        version: routing.version,
        acceptanceExpiresAt: routing.acceptanceExpiresAt,
      },
    );
    this.realtime.publish(`merchant:${routing.merchantId}`, 'order.updated', {
      orderId: available.id,
      status: 'SEARCHING_COURIER',
      version: routing.version,
    });
    return available;
  }

  private async createLifecycleEvidence(
    transaction: Transaction,
    order: { id: string; status: OrderStatus },
    toStatus: OrderStatus,
    eventType: OrderEventType,
    actor: CourierActor,
  ) {
    await transaction.orderEvent.create({
      data: {
        orderId: order.id,
        eventType,
        fromStatus: order.status,
        toStatus,
        actorType: 'USER',
        actorId: actor.userId,
        actorRole: databaseRoleByRole[actor.role],
        source: 'COURIER_MOBILE',
        merchantMessage: this.merchantMessage(toStatus),
      },
    });
    await writeAudit(transaction, {
      actorId: actor.userId,
      actorRole: databaseRoleByRole[actor.role],
      action: `courier_order.${eventType.toLowerCase()}`,
      entityType: 'DeliveryOrder',
      entityId: order.id,
      before: { status: order.status },
      after: { status: toStatus },
    });
  }

  private merchantMessage(status: OrderStatus): string {
    const messages: Partial<Record<OrderStatus, string>> = {
      COURIER_ARRIVING_PICKUP: 'المندوب في طريقه إلى نقطة الاستلام.',
      AT_PICKUP: 'وصل المندوب إلى نقطة الاستلام.',
      PICKED_UP: 'استلم المندوب الطلب.',
      IN_TRANSIT: 'الطلب في الطريق إلى العميل.',
      AT_DROPOFF: 'وصل المندوب إلى موقع التسليم.',
      DELIVERED: 'أبلغ المندوب عن تسليم الطلب.',
      DELIVERY_FAILED: 'تعذر تسليم الطلب ويجري تنفيذ مسار الإرجاع.',
      RETURNING_TO_STORE: 'الطلب في طريق العودة إلى المتجر.',
      RETURN_AWAITING_MERCHANT_CONFIRMATION:
        'أبلغ المندوب بوصول المرتجع وينتظر تأكيد التاجر.',
      RETURNED: 'أعيد الطلب إلى المتجر.',
    };
    return messages[status] ?? 'تم تحديث حالة الطلب.';
  }

  private safeMarketplaceOrder<
    T extends {
      id: string;
      orderNumber: string;
      version: number;
      routeDistanceMeters: number;
      estimatedDurationSeconds: number;
      packageSize: string;
      weightGrams: number;
      fragile: boolean;
      requiresThermalBag: boolean;
      merchantTotalMinor: number;
      estimatedCourierEarningMinor: number;
      currency: string;
      createdAt: Date;
      acceptanceExpiresAt: Date | null;
      dispatchAttemptCount: number;
      dropoffAddressSnapshot: Prisma.JsonValue;
      store: { name: string; area: string };
      serviceZone: { name: string };
    },
  >(order: T) {
    const dropoff = order.dropoffAddressSnapshot as {
      area?: string;
      city?: string;
    };
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      version: order.version,
      pickupStoreName: order.store.name,
      pickupArea: order.store.area || order.serviceZone.name,
      dropoffArea: dropoff.area ?? dropoff.city ?? order.serviceZone.name,
      serviceZoneName: order.serviceZone.name,
      routeDistanceMeters: order.routeDistanceMeters,
      estimatedDurationSeconds: order.estimatedDurationSeconds,
      packageSize: order.packageSize,
      weightGrams: order.weightGrams,
      fragile: order.fragile,
      requiresThermalBag: order.requiresThermalBag,
      deliveryFeeMinor: order.merchantTotalMinor,
      estimatedCourierNetMinor: order.estimatedCourierEarningMinor,
      currency: order.currency,
      createdAt: order.createdAt,
      acceptanceExpiresAt: order.acceptanceExpiresAt,
      dispatchAttemptCount: order.dispatchAttemptCount,
    };
  }

  private assignedOrderInclude() {
    return {
      store: { select: { id: true, name: true, phone: true } },
      serviceZone: { select: { id: true, name: true } },
      events: {
        select: {
          id: true,
          eventType: true,
          fromStatus: true,
          toStatus: true,
          reasonCode: true,
          merchantMessage: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' as const },
      },
      courierLedgerEntries: {
        select: {
          id: true,
          type: true,
          amountMinor: true,
          settlementLine: { select: { settlementPeriodId: true } },
        },
      },
      deliveryDispute: {
        select: {
          id: true,
          status: true,
          merchantReason: true,
          merchantNote: true,
          courierResponse: true,
          paperProofAvailable: true,
          courierRespondedAt: true,
          resolutionNote: true,
          version: true,
          createdAt: true,
        },
      },
    };
  }

  private fullCourierOrder<
    T extends {
      currency: string;
      customerSnapshot: Prisma.JsonValue;
      declaredValueMinor: number;
      pickupAddressSnapshot: Prisma.JsonValue;
      dropoffAddressSnapshot: Prisma.JsonValue;
      estimatedCourierEarningMinor: number;
      merchantTotalMinor: number;
      packageSnapshot: Prisma.JsonValue;
      paymentMode: 'DELIVERY_ONLY' | 'CASH_ON_DELIVERY';
      platformCommissionMinor: number;
    },
  >(order: T) {
    return {
      ...order,
      financialDetails: courierFinancialDetails(order),
    };
  }

  private async assignedOrder(userId: string, orderId: string) {
    const courier = await this.courierForUser(this.database, userId);
    const order = await this.database.deliveryOrder.findFirst({
      where: { id: orderId, courierId: courier.id },
      include: this.assignedOrderInclude(),
    });
    if (!order) throw new NotFoundException('Assigned order was not found.');
    return this.fullCourierOrder(order);
  }

  private async eligibleCourier(
    database: PrismaClient | Transaction,
    userId: string,
  ) {
    const courier = await this.courierForUser(database, userId);
    const eligibility = courierOperationalEligibility({
      accountStatus: courier.user.status,
      verificationStatus: courier.verificationStatus,
      hasActiveMotorcycle: courier.vehicles.some(
        (vehicle) => vehicle.active && vehicle.type === 'MOTORCYCLE',
      ),
      documents: courier.documents,
    });
    if (!eligibility.eligible) {
      throw new ForbiddenException({
        message: 'Courier is not operationally eligible.',
        reasons: eligibility.reasons,
      });
    }
    return courier;
  }

  private async courierForUser(
    database: PrismaClient | Transaction,
    userId: string,
  ) {
    const courier = await database.courierProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { status: true } },
        vehicles: {
          select: { active: true, type: true },
        },
        documents: {
          where: { isCurrent: true },
          select: {
            type: true,
            status: true,
            expiresAt: true,
            isCurrent: true,
          },
        },
        serviceZones: {
          include: {
            serviceZone: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!courier) throw new NotFoundException('Courier profile was not found.');
    return courier;
  }

  private async assertZoneEligibility(
    transaction: Transaction,
    courierId: string,
    serviceZoneId: string,
  ) {
    const membership = await transaction.courierServiceZone.findFirst({
      where: {
        courierId,
        serviceZoneId,
        active: true,
        serviceZone: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Courier does not operate in this service zone.',
      );
    }
  }

  private async serializableTransaction<T>(
    operation: (transaction: Transaction) => Promise<T>,
    _options?: { isolationLevel: 'Serializable' },
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.database.$transaction(operation, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (attempt === 0 && this.isSerializationFailure(error)) continue;
        throw error;
      }
    }
    throw new ConflictException('The order changed. Reload and retry.');
  }

  private isSerializationFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      code?: string;
      meta?: {
        driverAdapterError?: { cause?: { originalCode?: string } };
      };
    };
    return (
      candidate.code === 'P2034' ||
      candidate.meta?.driverAdapterError?.cause?.originalCode === '40001'
    );
  }

  private async claimIdempotency(
    transaction: Transaction,
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
      if (existing.status === 'PROCESSING') {
        throw new ConflictException('The request is already processing.');
      }
      return;
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

  private async completeIdempotency(
    transaction: Transaction,
    scope: string,
    key: string,
    entityId: string,
    responseCode: number,
  ) {
    await transaction.idempotencyRecord.update({
      where: { scope_key: { scope, key } },
      data: {
        status: 'COMPLETED',
        responseCode,
        responseBody: { entityId },
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
    const response = record.responseBody as { entityId?: string } | null;
    if (record.status === 'COMPLETED' && response?.entityId) {
      return response.entityId;
    }
    throw new ConflictException('The request is already processing.');
  }

  private async idempotencyReplayIfCompleted(
    scope: string,
    key: string,
    requestHash: string,
  ) {
    try {
      return await this.idempotencyReplay(scope, key, requestHash);
    } catch {
      return undefined;
    }
  }
}
