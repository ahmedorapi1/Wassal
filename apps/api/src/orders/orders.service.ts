import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@wasel/contracts';
import type {
  OrderEventSource,
  Prisma,
  PrismaClient,
  UserRole,
} from '@wasel/database';
import type { ServerEnvironment } from '@wasel/config';
import {
  DeterministicLocalMapsProvider,
  type MapsProvider,
} from '@wasel/providers';
import type {
  packageDetailsSchema,
  quoteRequestSchema,
  z,
} from '@wasel/validation';
import { normalizeEgyptianPhone } from '@wasel/validation';
import type Redis from 'ioredis';

import { writeAudit } from '../infrastructure/audit.js';
import {
  DATABASE,
  ENVIRONMENT,
  MAPS_PROVIDER,
  REDIS,
} from '../infrastructure/tokens.js';
import { databaseRoleByRole } from '../infrastructure/request.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { merchantContext } from '../merchant/merchant-context.js';
import {
  acceptanceDeadline,
  calculatePrice,
  canRetryCourierSearch,
  canTransitionInPhaseTwo,
  createOrderNumber,
  maximumDispatchAttempts,
  merchantCancellationDecision,
  quoteIsExpired,
  requestFingerprint,
  resolvePricingRule,
  type PricingRuleSnapshot,
} from './order-domain.js';

type QuoteRequest = z.infer<typeof quoteRequestSchema>;
type PackageInput = z.infer<typeof packageDetailsSchema>;
type Transaction = Prisma.TransactionClient;

type ZoneRow = {
  id: string;
  name: string;
  countryCode: string;
  governorate: string;
  city: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  status: string;
  allowedPickup: boolean;
  allowedDropoff: boolean;
  maximumRouteDistanceMeters: number;
  pickupStraightLineDistanceMeters: number;
  dropoffStraightLineDistanceMeters: number;
  priority: number;
  version: number;
};

type ZoneCandidateRow = ZoneRow & {
  pickupInside: boolean;
  dropoffInside: boolean;
  pricingAvailable: boolean;
};

type PointRow = {
  latitude: number;
  longitude: number;
};

type QuoteDiagnostics = {
  selectedStoreId: string;
  branchLatitude: number | null;
  branchLongitude: number | null;
  pickupAddressLatitude: number | null;
  pickupAddressLongitude: number | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  selectedMapMarkerLatitude: number | null;
  selectedMapMarkerLongitude: number | null;
  locationSource: string;
  resolvedServiceZoneId: string | null;
  resolvedServiceZoneName: string | null;
  zoneCenterLatitude: number | null;
  zoneCenterLongitude: number | null;
  zoneRadiusKm: number | null;
  zoneActiveStatus: string | null;
  pickupStraightLineDistanceMeters: number | null;
  deliveryStraightLineDistanceMeters: number | null;
  actualRouteDistanceMeters: number | null;
  serviceZoneMaximumRouteDistanceMeters: number | null;
  pricingRuleMaximumRouteDistanceMeters: number | null;
  maximumRouteDistanceMeters: number | null;
  candidateServiceZoneId: string | null;
  candidateServiceZoneName: string | null;
  candidatePickupInside: boolean | null;
  candidateDeliveryInside: boolean | null;
  candidatePricingAvailable: boolean | null;
  finalValidationFailureCode: string | null;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENVIRONMENT) private readonly environment: ServerEnvironment,
    @Inject(MAPS_PROVIDER)
    private readonly maps: MapsProvider = new DeterministicLocalMapsProvider(),
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  public async createQuote(
    userId: string,
    input: QuoteRequest,
    idempotencyKey: string,
    supersedesId?: string,
  ) {
    const diagnostics = this.quoteDiagnostics(input);
    const membership = await merchantContext(this.database, userId);
    const fingerprint = requestFingerprint(input);
    const existing = await this.database.priceQuote.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId: membership.merchantId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConflictException(
          'The idempotency key was already used with different quote data.',
        );
      }
      return this.quote(userId, existing.id);
    }
    await this.enforceRateLimit(
      'quote',
      userId,
      this.environment.QUOTE_RATE_LIMIT_PER_MINUTE,
    );

    try {
      const created = await this.database.$transaction(
        async (transaction) => {
          const customer = await this.resolveCustomer(
            transaction,
            membership.merchantId,
            input.customer,
          );
          const store = await this.storeWithPoint(
            transaction,
            membership.merchantId,
            input.storeId,
          );
          diagnostics.branchLatitude = store.latitude;
          diagnostics.branchLongitude = store.longitude;
          const pickupAddress = await this.createStoreAddress(
            transaction,
            membership.merchantId,
            store,
          );
          const dropoffAddress = await this.resolveDropoff(
            transaction,
            membership.merchantId,
            customer.id,
            input.dropoff,
          );
          const pickupPoint = {
            latitude: Number(pickupAddress.latitude),
            longitude: Number(pickupAddress.longitude),
          };
          const dropoffPoint = {
            latitude: Number(dropoffAddress.latitude),
            longitude: Number(dropoffAddress.longitude),
          };
          diagnostics.pickupAddressLatitude = pickupPoint.latitude;
          diagnostics.pickupAddressLongitude = pickupPoint.longitude;
          diagnostics.deliveryLatitude = dropoffPoint.latitude;
          diagnostics.deliveryLongitude = dropoffPoint.longitude;
          const zone = await this.resolveZone(
            transaction,
            pickupPoint,
            dropoffPoint,
            diagnostics,
          );
          this.applyResolvedZoneDiagnostics(diagnostics, zone);
          const route = await this.maps
            .route(pickupPoint, dropoffPoint)
            .catch(() => {
              throw new BadRequestException({
                code: 'order_route_calculation_failed',
                message: 'تعذر حساب المسافة، حاول تحديد الموقع مرة أخرى.',
              });
            });
          const rule = await this.resolveRule(transaction, zone);
          diagnostics.actualRouteDistanceMeters = route.distanceMeters;
          diagnostics.serviceZoneMaximumRouteDistanceMeters =
            zone.maximumRouteDistanceMeters;
          diagnostics.pricingRuleMaximumRouteDistanceMeters =
            rule.maximumDistanceMeters;
          diagnostics.maximumRouteDistanceMeters = Math.min(
            zone.maximumRouteDistanceMeters,
            rule.maximumDistanceMeters,
          );
          const financialSetting =
            await this.resolveFinancialSetting(transaction);
          if (
            route.distanceMeters > zone.maximumRouteDistanceMeters ||
            route.distanceMeters > rule.maximumDistanceMeters
          ) {
            throw new BadRequestException({
              code: 'order_route_distance_exceeded',
              message: 'المسافة الفعلية للطلب تتجاوز الحد الأقصى المسموح.',
            });
          }
          if (
            input.package.weightGrams > this.environment.ORDER_MAX_WEIGHT_GRAMS
          ) {
            throw new BadRequestException(
              'The package exceeds the supported weight.',
            );
          }
          if (
            input.package.declaredValueMinor >
            this.environment.ORDER_MAX_DECLARED_VALUE_MINOR
          ) {
            throw new BadRequestException(
              'The declared value exceeds the supported limit.',
            );
          }
          const packageSize = input.package.size.toUpperCase() as
            'SMALL' | 'MEDIUM' | 'LARGE';
          const pricingRuleSnapshot = this.pricingRuleSnapshot(rule);
          const breakdown = calculatePrice(
            pricingRuleSnapshot,
            {
              distanceMeters: route.distanceMeters,
              packageSize,
              weightGrams: input.package.weightGrams,
              fragile: input.package.fragile,
              requiresThermalBag: input.package.requiresThermalBag,
            },
            financialSetting.defaultCommissionBasisPoints,
          );
          const persistedQuoteAmounts = {
            baseFeeMinor: breakdown.baseFeeMinor,
            distanceChargeMinor: breakdown.distanceChargeMinor,
            packageSurchargeMinor: breakdown.packageSurchargeMinor,
            weightSurchargeMinor: breakdown.weightSurchargeMinor,
            fragileSurchargeMinor: breakdown.fragileSurchargeMinor,
            thermalBagSurchargeMinor: breakdown.thermalBagSurchargeMinor,
            discountMinor: breakdown.discountMinor,
            surgeAdjustmentMinor: breakdown.surgeAdjustmentMinor,
            taxMinor: breakdown.taxMinor,
            merchantTotalMinor: breakdown.merchantTotalMinor,
            estimatedCourierEarningMinor:
              breakdown.estimatedCourierEarningMinor,
            platformCommissionMinor: breakdown.platformCommissionMinor,
            platformCommissionBasisPoints:
              breakdown.platformCommissionBasisPoints,
          };
          const customerSnapshot = {
            id: customer.id,
            name: customer.name,
            normalizedPhone: customer.normalizedPhone,
            email: customer.email,
          };
          const pickupSnapshot = this.addressSnapshot(pickupAddress, 'STORE');
          const dropoffSnapshot = this.addressSnapshot(
            dropoffAddress,
            'addressId' in input.dropoff
              ? 'SAVED_ADDRESS'
              : input.dropoff.locationSource,
          );
          const routeSnapshot = {
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            provider: 'deterministic_local',
            providerVersion: 1,
          };
          const quote = await transaction.priceQuote.create({
            data: {
              merchantId: membership.merchantId,
              storeId: store.id,
              customerId: customer.id,
              serviceZoneId: zone.id,
              pricingRuleId: rule.id,
              createdById: userId,
              pricingRuleVersion: rule.version,
              customerSnapshot,
              pickupAddressSnapshot: pickupSnapshot,
              dropoffAddressSnapshot: dropoffSnapshot,
              packageSnapshot: input.package,
              routeSnapshot,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              ...persistedQuoteAmounts,
              currency: rule.currency,
              breakdown: {
                ...breakdown,
                currency: rule.currency,
                pricingRuleVersion: rule.version,
                financialSettingsVersion: financialSetting.version,
              },
              requestFingerprint: fingerprint,
              idempotencyKey,
              expiresAt: new Date(
                Date.now() + this.environment.QUOTE_TTL_SECONDS * 1_000,
              ),
              supersedesId,
            },
          });
          if (supersedesId) {
            await transaction.priceQuote.updateMany({
              where: {
                id: supersedesId,
                merchantId: membership.merchantId,
                status: { in: ['ACTIVE', 'EXPIRED'] },
              },
              data: { status: 'SUPERSEDED', version: { increment: 1 } },
            });
          }
          await writeAudit(transaction, {
            actorId: userId,
            actorRole: membership.role,
            action: supersedesId ? 'quote.recalculated' : 'quote.created',
            entityType: 'PriceQuote',
            entityId: quote.id,
            metadata: {
              serviceZoneId: zone.id,
              pricingRuleId: rule.id,
              pricingRuleVersion: rule.version,
              financialSettingsVersion: financialSetting.version,
              platformCommissionBasisPoints:
                financialSetting.defaultCommissionBasisPoints,
            },
          });
          return quote;
        },
        { isolationLevel: 'Serializable' },
      );
      this.debugQuoteDiagnostics(diagnostics);
      return this.quote(userId, created.id);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const raced = await this.database.priceQuote.findUnique({
          where: {
            merchantId_idempotencyKey: {
              merchantId: membership.merchantId,
              idempotencyKey,
            },
          },
        });
        if (raced?.requestFingerprint === fingerprint) {
          return this.quote(userId, raced.id);
        }
      }
      diagnostics.finalValidationFailureCode =
        this.quoteFailureCode(error) ?? 'order_quote_failed';
      this.debugQuoteDiagnostics(diagnostics);
      throw error;
    }
  }

  public async quote(userId: string, quoteId: string) {
    const membership = await merchantContext(this.database, userId);
    let quote = await this.database.priceQuote.findFirst({
      where: { id: quoteId, merchantId: membership.merchantId },
      include: {
        serviceZone: { select: { id: true, name: true } },
        pricingRule: {
          select: { id: true, ruleFamilyKey: true, version: true },
        },
      },
    });
    if (!quote) throw new NotFoundException('Quote was not found.');
    if (quote.status === 'ACTIVE' && quoteIsExpired(quote.expiresAt)) {
      await this.database.priceQuote.update({
        where: { id: quote.id },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      quote = { ...quote, status: 'EXPIRED', version: quote.version + 1 };
    }
    return {
      ...quote,
      expiresInSeconds: Math.max(
        0,
        Math.ceil((quote.expiresAt.getTime() - Date.now()) / 1_000),
      ),
    };
  }

  public async recalculateQuote(
    userId: string,
    quoteId: string,
    idempotencyKey: string,
  ) {
    const original = await this.quote(userId, quoteId);
    if (original.status === 'CONSUMED' || original.status === 'CANCELLED') {
      throw new ConflictException('This quote cannot be recalculated.');
    }
    const customer = original.customerSnapshot as {
      id: string;
    };
    const dropoff = original.dropoffAddressSnapshot as {
      id: string;
    };
    return this.createQuote(
      userId,
      {
        storeId: original.storeId,
        customer: { customerId: customer.id },
        dropoff: { addressId: dropoff.id },
        package: original.packageSnapshot as PackageInput,
      },
      idempotencyKey,
      original.id,
    );
  }

  public async createOrder(
    actor: { userId: string; role: Role },
    quoteId: string,
    quoteVersion: number,
    locationReviewed: true,
    idempotencyKey: string,
  ) {
    const membership = await merchantContext(this.database, actor.userId);
    const scope = `order:create:${membership.merchantId}`;
    const fingerprint = requestFingerprint({
      quoteId,
      quoteVersion,
      locationReviewed,
    });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.order(actor.userId, replay);
    await this.enforceRateLimit(
      'order',
      actor.userId,
      this.environment.ORDER_RATE_LIMIT_PER_MINUTE,
    );

    try {
      const orderId = await this.database.$transaction(
        async (transaction) => {
          await this.claimIdempotency(
            transaction,
            scope,
            idempotencyKey,
            fingerprint,
          );
          await transaction.$queryRaw`
            SELECT "id" FROM "PriceQuote"
            WHERE "id" = ${quoteId}::uuid
            FOR UPDATE
          `;
          const quote = await transaction.priceQuote.findFirst({
            where: {
              id: quoteId,
              merchantId: membership.merchantId,
            },
            include: {
              store: true,
              serviceZone: true,
              order: { select: { id: true } },
            },
          });
          if (!quote) throw new NotFoundException('Quote was not found.');
          if (quote.order) {
            await this.completeIdempotency(
              transaction,
              scope,
              idempotencyKey,
              quote.order.id,
            );
            return quote.order.id;
          }
          if (quote.status !== 'ACTIVE' || quoteIsExpired(quote.expiresAt)) {
            throw new ConflictException('The quote is no longer valid.');
          }
          if (quote.version !== quoteVersion || locationReviewed !== true) {
            throw new ConflictException(
              'The current quote and delivery location must be reviewed before order confirmation.',
            );
          }
          if (quote.store.status !== 'ACTIVE') {
            throw new ConflictException('The pickup store is inactive.');
          }
          await this.revalidateZone(transaction, quote);
          if (
            !canTransitionInPhaseTwo('DRAFT', 'QUOTED') ||
            !canTransitionInPhaseTwo('QUOTED', 'SEARCHING_COURIER')
          ) {
            throw new ConflictException('The order transition is not allowed.');
          }
          const customerSnapshot = quote.customerSnapshot as {
            id: string;
          };
          const pickupSnapshot = quote.pickupAddressSnapshot as {
            id: string;
          };
          const dropoffSnapshot = quote.dropoffAddressSnapshot as {
            id: string;
          };
          const packageSnapshot = quote.packageSnapshot as PackageInput;
          const breakdown = quote.breakdown as Record<string, number | string>;
          const publishedAt = new Date();
          const acceptanceExpiresAt = acceptanceDeadline(publishedAt);
          const order = await transaction.deliveryOrder.create({
            data: {
              orderNumber: await this.uniqueOrderNumber(transaction),
              quoteId: quote.id,
              merchantId: membership.merchantId,
              storeId: quote.storeId,
              customerId: customerSnapshot.id,
              pickupAddressId: pickupSnapshot.id,
              dropoffAddressId: dropoffSnapshot.id,
              serviceZoneId: quote.serviceZoneId,
              pricingRuleId: quote.pricingRuleId,
              createdById: actor.userId,
              status: 'SEARCHING_COURIER',
              acceptanceExpiresAt,
              dispatchAttemptCount: 1,
              customerSnapshot: quote.customerSnapshot as Prisma.InputJsonValue,
              pickupAddressSnapshot:
                quote.pickupAddressSnapshot as Prisma.InputJsonValue,
              dropoffAddressSnapshot:
                quote.dropoffAddressSnapshot as Prisma.InputJsonValue,
              packageSnapshot: quote.packageSnapshot as Prisma.InputJsonValue,
              routeSnapshot: quote.routeSnapshot as Prisma.InputJsonValue,
              pricingSnapshot: breakdown,
              packageCategory: packageSnapshot.category,
              itemDescription: packageSnapshot.itemDescription,
              packageSize: packageSnapshot.size.toUpperCase() as
                'SMALL' | 'MEDIUM' | 'LARGE',
              weightGrams: packageSnapshot.weightGrams,
              packageCount: packageSnapshot.packageCount,
              fragile: packageSnapshot.fragile,
              requiresThermalBag: packageSnapshot.requiresThermalBag,
              recipientNotes: packageSnapshot.recipientNotes,
              courierNotes: packageSnapshot.courierNotes,
              declaredValueMinor: packageSnapshot.declaredValueMinor,
              prohibitedItemsConfirmed:
                packageSnapshot.prohibitedItemsConfirmed,
              merchantReference: packageSnapshot.merchantReference,
              customerOrderReference: packageSnapshot.customerOrderReference,
              routeDistanceMeters: quote.distanceMeters,
              estimatedDurationSeconds: quote.durationSeconds,
              baseFeeMinor: quote.baseFeeMinor,
              distanceChargeMinor: quote.distanceChargeMinor,
              packageSurchargeMinor: quote.packageSurchargeMinor,
              weightSurchargeMinor: quote.weightSurchargeMinor,
              fragileSurchargeMinor: quote.fragileSurchargeMinor,
              thermalBagSurchargeMinor: quote.thermalBagSurchargeMinor,
              discountMinor: quote.discountMinor,
              surgeAdjustmentMinor: 0,
              taxMinor: quote.taxMinor,
              merchantTotalMinor: quote.merchantTotalMinor,
              estimatedCourierEarningMinor: quote.estimatedCourierEarningMinor,
              platformCommissionMinor: quote.platformCommissionMinor,
              platformCommissionBasisPoints:
                quote.platformCommissionBasisPoints,
              currency: quote.currency,
              pricingVersion: quote.pricingRuleVersion,
            },
          });
          await transaction.orderEvent.createMany({
            data: [
              this.event(
                order.id,
                'ORDER_DRAFT_CREATED',
                null,
                'DRAFT',
                actor,
                'تم إنشاء مسودة طلب التوصيل.',
              ),
              this.event(
                order.id,
                'QUOTE_CREATED',
                'DRAFT',
                'QUOTED',
                actor,
                'تم تثبيت عرض السعر على الطلب.',
              ),
              this.event(
                order.id,
                'ORDER_CONFIRMED',
                'QUOTED',
                'SEARCHING_COURIER',
                actor,
                'تم تأكيد الطلب.',
              ),
              this.event(
                order.id,
                'COURIER_SEARCH_REQUESTED',
                'SEARCHING_COURIER',
                'SEARCHING_COURIER',
                actor,
                'بدأ البحث عن مندوب لمدة خمس دقائق.',
                {
                  attempt: 1,
                  publishedAt: publishedAt.toISOString(),
                  expiresAt: acceptanceExpiresAt.toISOString(),
                },
              ),
            ],
          });
          await transaction.priceQuote.update({
            where: { id: quote.id },
            data: {
              status: 'CONSUMED',
              consumedAt: publishedAt,
              version: { increment: 1 },
            },
          });
          await writeAudit(transaction, {
            actorId: actor.userId,
            actorRole: membership.role,
            action: 'order.created',
            entityType: 'DeliveryOrder',
            entityId: order.id,
            metadata: {
              orderNumber: order.orderNumber,
              quoteId: quote.id,
            },
          });
          await this.completeIdempotency(
            transaction,
            scope,
            idempotencyKey,
            order.id,
          );
          return order.id;
        },
        { isolationLevel: 'Serializable' },
      );
      const created = await this.order(actor.userId, orderId);
      this.realtime.publish(
        `service-zone:${created.serviceZoneId}`,
        'marketplace.order.available',
        {
          orderId: created.id,
          serviceZoneId: created.serviceZoneId,
          status: created.status,
          version: created.version,
          acceptanceExpiresAt: created.acceptanceExpiresAt,
          dispatchAttemptCount: created.dispatchAttemptCount,
        },
      );
      this.realtime.publish(`merchant:${created.merchantId}`, 'order.updated', {
        orderId: created.id,
        status: created.status,
        version: created.version,
      });
      return created;
    } catch (error) {
      const replayAfterRace = await this.idempotencyReplay(
        scope,
        idempotencyKey,
        fingerprint,
      );
      if (replayAfterRace) return this.order(actor.userId, replayAfterRace);
      throw error;
    }
  }

  public async orders(
    userId: string,
    input: {
      page: number;
      pageSize: number;
      status?: string;
      search?: string;
    },
  ) {
    const membership = await merchantContext(this.database, userId);
    const where: Prisma.DeliveryOrderWhereInput = {
      merchantId: membership.merchantId,
      ...(input.status
        ? { status: input.status as Prisma.EnumOrderStatusFilter['equals'] }
        : {}),
      ...(input.search
        ? {
            OR: [
              {
                orderNumber: {
                  contains: input.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                customer: {
                  name: {
                    contains: input.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.deliveryOrder.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, normalizedPhone: true },
          },
          store: { select: { id: true, name: true } },
          serviceZone: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.deliveryOrder.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  public async order(userId: string, orderId: string) {
    const membership = await merchantContext(this.database, userId);
    const order = await this.database.deliveryOrder.findFirst({
      where: { id: orderId, merchantId: membership.merchantId },
      include: {
        store: { select: { id: true, name: true } },
        serviceZone: { select: { id: true, name: true } },
        events: {
          select: {
            id: true,
            eventType: true,
            fromStatus: true,
            toStatus: true,
            source: true,
            reasonCode: true,
            merchantMessage: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Order was not found.');
    return order;
  }

  public async events(userId: string, orderId: string) {
    const order = await this.order(userId, orderId);
    return order.events;
  }

  public async retryCourierSearch(
    actor: { userId: string; role: Role },
    orderId: string,
    version: number,
    idempotencyKey: string,
  ) {
    if (actor.role === 'merchant_staff') {
      throw new ForbiddenException(
        'Merchant staff cannot restart courier search.',
      );
    }
    const membership = await merchantContext(this.database, actor.userId);
    const scope = `order:retry-courier-search:${orderId}`;
    const fingerprint = requestFingerprint({ orderId, version });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.order(actor.userId, replay);

    const retriedId = await this.serializableTransaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await transaction.$queryRaw`
          SELECT "id" FROM "DeliveryOrder"
          WHERE "id" = ${orderId}::uuid
          FOR UPDATE
        `;
        const order = await transaction.deliveryOrder.findFirst({
          where: { id: orderId, merchantId: membership.merchantId },
        });
        if (!order) throw new NotFoundException('Order was not found.');
        if (
          order.status === 'NO_COURIER_AVAILABLE_FINAL' ||
          order.dispatchAttemptCount >= maximumDispatchAttempts
        ) {
          throw new ConflictException({
            code: 'COURIER_SEARCH_RETRY_LIMIT_REACHED',
            message:
              'انتهت محاولتا البحث عن مندوب. يمكنك إلغاء الطلب مجاناً أو التواصل مع الدعم.',
          });
        }
        if (!canRetryCourierSearch(order) || order.version !== version) {
          throw new ConflictException({
            code: 'COURIER_SEARCH_RETRY_NOT_ALLOWED',
            message:
              'لا يمكن إعادة البحث عن مندوب في حالة الطلب الحالية. حدّث الطلب وحاول مجدداً.',
          });
        }
        const publishedAt = new Date();
        const expiresAt = acceptanceDeadline(publishedAt);
        const attempt = order.dispatchAttemptCount + 1;
        const updated = await transaction.deliveryOrder.updateMany({
          where: {
            id: order.id,
            merchantId: membership.merchantId,
            status: 'NO_COURIER_AVAILABLE',
            courierId: null,
            version,
            dispatchAttemptCount: 1,
          },
          data: {
            status: 'SEARCHING_COURIER',
            acceptanceExpiresAt: expiresAt,
            dispatchAttemptCount: attempt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'The order changed before courier search could restart.',
          );
        }
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'COURIER_SEARCH_RESTARTED',
            fromStatus: 'NO_COURIER_AVAILABLE',
            toStatus: 'SEARCHING_COURIER',
            actorType: 'USER',
            actorId: actor.userId,
            actorRole: membership.role,
            source: 'MERCHANT_WEB',
            merchantMessage:
              'بدأت محاولة البحث الثانية عن مندوب لمدة خمس دقائق.',
            metadata: {
              attempt,
              publishedAt: publishedAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: membership.role,
          action: 'order.courier_search_restarted',
          entityType: 'DeliveryOrder',
          entityId: order.id,
          before: {
            status: order.status,
            dispatchAttemptCount: order.dispatchAttemptCount,
          },
          after: {
            status: 'SEARCHING_COURIER',
            dispatchAttemptCount: attempt,
            acceptanceExpiresAt: expiresAt,
          },
        });
        await this.completeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          order.id,
        );
        return order.id;
      },
      { isolationLevel: 'Serializable' },
    );
    const retried = await this.order(actor.userId, retriedId);
    this.realtime.publish(
      `service-zone:${retried.serviceZoneId}`,
      'marketplace.order.available',
      {
        orderId: retried.id,
        serviceZoneId: retried.serviceZoneId,
        status: retried.status,
        version: retried.version,
        acceptanceExpiresAt: retried.acceptanceExpiresAt,
        dispatchAttemptCount: retried.dispatchAttemptCount,
      },
    );
    this.realtime.publish(`merchant:${retried.merchantId}`, 'order.updated', {
      orderId: retried.id,
      status: retried.status,
      version: retried.version,
    });
    return retried;
  }

  public async cancelMerchant(
    actor: { userId: string; role: Role },
    orderId: string,
    input: { reasonCode: string; details?: string; version: number },
    idempotencyKey: string,
  ) {
    if (actor.role === 'merchant_staff') {
      throw new ForbiddenException('Merchant staff cannot cancel orders.');
    }
    const membership = await merchantContext(this.database, actor.userId);
    return this.cancel({
      actor,
      databaseRole: membership.role,
      orderId,
      merchantId: membership.merchantId,
      input,
      idempotencyKey,
      source: 'MERCHANT_WEB',
    });
  }

  public async cancelAdmin(
    actor: { userId: string; role: Role },
    orderId: string,
    input: { reasonCode: string; details?: string; version: number },
    idempotencyKey: string,
  ) {
    return this.cancel({
      actor,
      databaseRole: databaseRoleByRole[actor.role],
      orderId,
      input,
      idempotencyKey,
      source: 'ADMIN_WEB',
    });
  }

  private async cancel(input: {
    actor: { userId: string; role: Role };
    databaseRole: UserRole;
    orderId: string;
    merchantId?: string;
    input: { reasonCode: string; details?: string; version: number };
    idempotencyKey: string;
    source: OrderEventSource;
  }) {
    const scope = `order:cancel:${input.orderId}`;
    const fingerprint = requestFingerprint(input.input);
    const replay = await this.idempotencyReplay(
      scope,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return this.orderForActor(input, replay);

    const cancellation = await this.serializableTransaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          input.idempotencyKey,
          fingerprint,
        );
        await transaction.$queryRaw`
          SELECT "id" FROM "DeliveryOrder"
          WHERE "id" = ${input.orderId}::uuid
          FOR UPDATE
        `;
        const order = await transaction.deliveryOrder.findFirst({
          where: {
            id: input.orderId,
            ...(input.merchantId ? { merchantId: input.merchantId } : {}),
          },
          include: {
            courier: { select: { id: true, userId: true } },
          },
        });
        if (!order) throw new NotFoundException('Order was not found.');
        if (order.status === 'CANCELLED' || order.cancelledAfterPickup) {
          if (
            order.cancellationReasonCode !== input.input.reasonCode ||
            (order.cancellationDetails ?? undefined) !== input.input.details
          ) {
            throw new ConflictException(
              'The order was already cancelled with a different reason.',
            );
          }
          await this.completeIdempotency(
            transaction,
            scope,
            input.idempotencyKey,
            order.id,
          );
          return {
            orderId: order.id,
            courierId: order.courierId,
            courierUserId: order.courier?.userId ?? null,
            notificationId: null as string | null,
            serviceZoneId: order.serviceZoneId,
            status: order.status,
          };
        }
        const decision = merchantCancellationDecision(
          order.status,
          order.merchantTotalMinor,
        );
        if (!decision) {
          throw new ConflictException({
            code: 'ORDER_CANCELLATION_NOT_ALLOWED',
            message: 'لا يمكن إلغاء الطلب في حالته الحالية.',
          });
        }
        const freeCancellation = decision.kind === 'FREE';
        const afterPickup = decision.kind === 'RETURN';
        const now = new Date();
        const toStatus = decision.toStatus;
        const cancellationChargeMinor = decision.cancellationChargeMinor;
        const updated = await transaction.deliveryOrder.updateMany({
          where: {
            id: order.id,
            version: input.input.version,
            status: order.status,
          },
          data: {
            status: toStatus,
            courierId: freeCancellation ? null : order.courierId,
            acceptanceExpiresAt: null,
            cancelledAt: now,
            cancelledById: input.actor.userId,
            cancellationReasonCode: input.input.reasonCode,
            cancellationDetails: input.input.details,
            cancelledByRole: input.databaseRole,
            cancelledAfterPickup: afterPickup,
            cancellationChargeMinor,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'The order changed before cancellation. Reload and retry.',
          );
        }
        await transaction.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: afterPickup
              ? input.source === 'ADMIN_WEB'
                ? 'ADMIN_CANCELLED'
                : 'MERCHANT_CANCELLED_AFTER_PICKUP'
              : input.source === 'ADMIN_WEB'
                ? 'ADMIN_CANCELLED'
                : 'ORDER_CANCELLED',
            fromStatus: order.status,
            toStatus,
            actorType: 'USER',
            actorId: input.actor.userId,
            actorRole: input.databaseRole,
            source: input.source,
            reasonCode: input.input.reasonCode,
            merchantMessage: afterPickup
              ? 'ألغى التاجر الطلب بعد استلام المندوب له. يجري إرجاع الطلب إلى الفرع وتظل قيمة التوصيل مستحقة بالكامل.'
              : 'تم إلغاء طلب التوصيل مجاناً قبل استلام المندوب له.',
            internalMessage: input.input.details,
            metadata: {
              cancellationTiming: afterPickup
                ? 'AFTER_PICKUP'
                : 'BEFORE_PICKUP',
              cancellationChargeMinor,
              originalDeliveryFeeMinor: order.merchantTotalMinor,
              courierId: order.courierId,
            },
          },
        });
        let notificationId: string | null = null;
        if (order.courier) {
          const notification = await transaction.notification.upsert({
            where: {
              deduplicationKey: `order:${order.id}:merchant-cancelled:${order.courier.userId}`,
            },
            update: {},
            create: {
              recipientUserId: order.courier.userId,
              type: afterPickup
                ? 'ORDER_RETURN_REQUIRED_BY_MERCHANT'
                : 'ORDER_CANCELLED_BY_MERCHANT',
              title: afterPickup
                ? 'إرجاع الطلب إلى الفرع'
                : 'ألغى التاجر الطلب',
              body: afterPickup
                ? 'ألغى التاجر الطلب بعد الاستلام. أعد الطلب إلى الفرع؛ قيمة التوصيل الأصلية محفوظة ولا توجد رسوم إرجاع إضافية.'
                : 'ألغى التاجر الطلب قبل الاستلام، وتمت إزالته من طلباتك النشطة.',
              relatedEntityType: 'DeliveryOrder',
              relatedEntityId: order.id,
              deepLink: `/orders/${order.id}`,
              deduplicationKey: `order:${order.id}:merchant-cancelled:${order.courier.userId}`,
              metadata: {
                afterPickup,
                cancellationChargeMinor,
              },
            },
          });
          notificationId = notification.id;
        }
        await writeAudit(transaction, {
          actorId: input.actor.userId,
          actorRole: input.databaseRole,
          action:
            input.source === 'ADMIN_WEB'
              ? 'order.admin_cancelled'
              : 'order.merchant_cancelled',
          entityType: 'DeliveryOrder',
          entityId: order.id,
          before: {
            status: order.status,
            version: order.version,
          },
          after: {
            status: toStatus,
            version: order.version + 1,
            cancelledAfterPickup: afterPickup,
            cancellationChargeMinor,
          },
          metadata: {
            reasonCode: input.input.reasonCode,
            details: input.input.details,
            courierId: order.courierId,
          },
        });
        await this.completeIdempotency(
          transaction,
          scope,
          input.idempotencyKey,
          order.id,
        );
        return {
          orderId: order.id,
          courierId: order.courierId,
          courierUserId: order.courier?.userId ?? null,
          notificationId,
          serviceZoneId: order.serviceZoneId,
          status: toStatus,
        };
      },
      { isolationLevel: 'Serializable' },
    );
    const cancelled = await this.orderForActor(input, cancellation.orderId);
    this.realtime.publish(
      `service-zone:${cancellation.serviceZoneId}`,
      'marketplace.order.removed',
      {
        orderId: cancellation.orderId,
        reason: 'merchant_cancelled',
        status: cancellation.status,
        version: cancelled.version,
      },
    );
    this.realtime.publish(`merchant:${cancelled.merchantId}`, 'order.updated', {
      orderId: cancelled.id,
      status: cancelled.status,
      version: cancelled.version,
    });
    if (cancellation.courierId) {
      this.realtime.publish(
        `courier:${cancellation.courierId}`,
        'order.updated',
        {
          orderId: cancelled.id,
          status: cancelled.status,
          version: cancelled.version,
          cancelledAfterPickup: cancelled.cancelledAfterPickup,
        },
      );
    }
    if (cancellation.courierUserId && cancellation.notificationId) {
      this.realtime.publish(
        `user:${cancellation.courierUserId}`,
        'notification.created',
        {
          notificationId: cancellation.notificationId,
          notificationType: cancelled.cancelledAfterPickup
            ? 'ORDER_RETURN_REQUIRED_BY_MERCHANT'
            : 'ORDER_CANCELLED_BY_MERCHANT',
        },
      );
    }
    return cancelled;
  }

  private async orderForActor(input: { merchantId?: string }, orderId: string) {
    if (input.merchantId) {
      const order = await this.database.deliveryOrder.findFirst({
        where: { id: orderId, merchantId: input.merchantId },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      });
      if (!order) throw new NotFoundException('Order was not found.');
      return order;
    }
    return this.database.deliveryOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  }

  private async resolveCustomer(
    transaction: Transaction,
    merchantId: string,
    input: QuoteRequest['customer'],
  ) {
    if ('customerId' in input) {
      const customer = await transaction.customer.findFirst({
        where: {
          id: input.customerId,
          merchantId,
          status: 'ACTIVE',
        },
      });
      if (!customer) throw new NotFoundException('Customer was not found.');
      return customer;
    }
    const normalizedPhone = normalizeEgyptianPhone(input.phone);
    const existing = await transaction.customer.findUnique({
      where: {
        merchantId_normalizedPhone: { merchantId, normalizedPhone },
      },
    });
    if (existing) {
      if (existing.status === 'ARCHIVED' || existing.name !== input.name) {
        return transaction.customer.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            ...(existing.status === 'ARCHIVED'
              ? { status: 'ACTIVE', archivedAt: null }
              : {}),
            version: { increment: 1 },
          },
        });
      }
      return existing;
    }
    return transaction.customer.create({
      data: {
        merchantId,
        name: input.name,
        normalizedPhone,
        email: input.email,
        notes: input.notes,
      },
    });
  }

  private async storeWithPoint(
    transaction: Transaction,
    merchantId: string,
    storeId: string,
  ) {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        merchantId: string;
        name: string;
        phone: string | null;
        addressLine: string;
        area: string;
        city: string;
        status: string;
        version: number;
        latitude: number | null;
        longitude: number | null;
      }>
    >`
      SELECT
        "id", "merchantId", "name", "phone", "addressLine", "area", "city",
        "status", "version",
        ST_Y("location"::geometry) AS "latitude",
        ST_X("location"::geometry) AS "longitude"
      FROM "Store"
      WHERE "id" = ${storeId}::uuid
        AND "merchantId" = ${merchantId}::uuid
        AND "status" = 'ACTIVE'
      LIMIT 1
    `;
    const store = rows[0];
    if (!store || store.latitude === null || store.longitude === null) {
      throw new NotFoundException({
        code: 'order_invalid_store',
        message: 'الفرع المحدد غير صالح.',
      });
    }
    return {
      ...store,
      latitude: store.latitude,
      longitude: store.longitude,
    };
  }

  private async createStoreAddress(
    transaction: Transaction,
    merchantId: string,
    store: Awaited<ReturnType<OrdersService['storeWithPoint']>>,
  ) {
    const existing = await transaction.address.findFirst({
      where: {
        merchantId,
        customerId: null,
        source: 'STORE',
        label: store.id,
        archivedAt: null,
      },
    });
    if (
      existing &&
      Number(existing.latitude) === store.latitude &&
      Number(existing.longitude) === store.longitude
    ) {
      return existing;
    }
    if (existing) {
      const updated = await transaction.address.update({
        where: { id: existing.id },
        data: {
          contactName: store.name,
          contactPhone: store.phone ?? '+201000000000',
          addressLine: store.addressLine,
          area: store.area,
          city: store.city,
          governorate: store.city,
          latitude: store.latitude,
          longitude: store.longitude,
          validationStatus: 'VALIDATED',
        },
      });
      await this.setAddressPoint(
        transaction,
        updated.id,
        store.latitude,
        store.longitude,
      );
      return updated;
    }
    const created = await transaction.address.create({
      data: {
        merchantId,
        label: store.id,
        contactName: store.name,
        contactPhone: store.phone ?? '+201000000000',
        addressLine: store.addressLine,
        area: store.area,
        city: store.city,
        governorate: store.city,
        latitude: store.latitude,
        longitude: store.longitude,
        source: 'STORE',
        validationStatus: 'VALIDATED',
      },
    });
    await this.setAddressPoint(
      transaction,
      created.id,
      store.latitude,
      store.longitude,
    );
    return created;
  }

  private async resolveDropoff(
    transaction: Transaction,
    merchantId: string,
    customerId: string,
    input: QuoteRequest['dropoff'],
  ) {
    if ('addressId' in input) {
      const address = await transaction.address.findFirst({
        where: {
          id: input.addressId,
          merchantId,
          customerId,
        },
      });
      if (!address)
        throw new NotFoundException('Drop-off address was not found.');
      return address;
    }
    const created = await transaction.address.create({
      data: {
        merchantId,
        customerId,
        label: input.label,
        contactName: input.contactName,
        contactPhone: normalizeEgyptianPhone(input.contactPhone),
        addressLine: input.addressLine,
        street: input.street,
        buildingNumber: input.buildingNumber,
        floor: input.floor,
        apartment: input.apartment,
        landmark: input.landmark,
        area: input.area,
        city: input.city,
        governorate: input.governorate,
        instructions: input.instructions,
        deliveryNotes: input.deliveryNotes,
        sourceMapsUrl: input.sourceMapsUrl,
        latitude: input.latitude,
        longitude: input.longitude,
        source: input.saveAddress ? 'SAVED' : 'MANUAL',
        validationStatus: 'VALIDATED',
        archivedAt: input.saveAddress ? null : new Date(),
      },
    });
    await this.setAddressPoint(
      transaction,
      created.id,
      input.latitude,
      input.longitude,
    );
    return created;
  }

  private async setAddressPoint(
    transaction: Transaction,
    addressId: string,
    latitude: number,
    longitude: number,
  ) {
    await transaction.$executeRaw`
      UPDATE "Address"
      SET "location" = ST_SetSRID(
        ST_MakePoint(${longitude}, ${latitude}),
        4326
      )::geography
      WHERE "id" = ${addressId}::uuid
    `;
  }

  private async resolveZone(
    transaction: Transaction,
    pickup: PointRow,
    dropoff: PointRow,
    diagnostics?: QuoteDiagnostics,
  ): Promise<ZoneRow> {
    const rows = await transaction.$queryRaw<ZoneRow[]>`
      SELECT
        z."id", z."name", z."countryCode", z."governorate", z."city",
        z."centerLatitude"::double precision AS "centerLatitude",
        z."centerLongitude"::double precision AS "centerLongitude",
        z."radiusKm"::double precision AS "radiusKm",
        z."status", z."allowedPickup", z."allowedDropoff",
        z."maximumRouteDistanceMeters", z."priority", z."version",
        ST_Distance(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),
            4326
          )::geography
        ) AS "pickupStraightLineDistanceMeters",
        ST_Distance(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${dropoff.longitude}, ${dropoff.latitude}),
            4326
          )::geography
        ) AS "dropoffStraightLineDistanceMeters"
      FROM "ServiceZone" z
      WHERE z."status" = 'ACTIVE'
        AND z."allowedPickup" = true
        AND z."allowedDropoff" = true
        AND ST_DWithin(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),
            4326
          )::geography,
          z."radiusKm"::double precision * 1000
        )
        AND ST_DWithin(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${dropoff.longitude}, ${dropoff.latitude}),
            4326
          )::geography,
          z."radiusKm"::double precision * 1000
        )
        AND EXISTS (
          SELECT 1
          FROM "PricingRule" pr
          WHERE pr."vehicleType" = 'MOTORCYCLE'
            AND pr."status" = 'ACTIVE'
            AND pr."effectiveFrom" <= NOW()
            AND (pr."effectiveTo" IS NULL OR pr."effectiveTo" > NOW())
            AND (
              pr."serviceZoneId" = z."id"
              OR (
                pr."serviceZoneId" IS NULL
                AND pr."countryCode" = z."countryCode"
                AND pr."governorate" = z."governorate"
                AND pr."city" = z."city"
              )
            )
        )
      ORDER BY z."priority" DESC, z."name" ASC
      LIMIT 1
    `;
    const zone = rows[0];
    if (!zone) {
      const candidates = await this.zoneCandidates(
        transaction,
        pickup,
        dropoff,
      );
      const commonCoverageWithoutPricing = candidates.find(
        (candidate) =>
          candidate.pickupInside &&
          candidate.dropoffInside &&
          !candidate.pricingAvailable,
      );
      const crossZoneCandidate = candidates.find(
        (candidate) => candidate.dropoffInside || candidate.pickupInside,
      );
      const candidate = commonCoverageWithoutPricing ?? crossZoneCandidate;
      if (candidate && diagnostics) {
        diagnostics.candidateServiceZoneId = candidate.id;
        diagnostics.candidateServiceZoneName = candidate.name;
        diagnostics.candidatePickupInside = candidate.pickupInside;
        diagnostics.candidateDeliveryInside = candidate.dropoffInside;
        diagnostics.candidatePricingAvailable = candidate.pricingAvailable;
        diagnostics.zoneCenterLatitude = candidate.centerLatitude;
        diagnostics.zoneCenterLongitude = candidate.centerLongitude;
        diagnostics.zoneRadiusKm = candidate.radiusKm;
        diagnostics.zoneActiveStatus = candidate.status;
        diagnostics.pickupStraightLineDistanceMeters =
          candidate.pickupStraightLineDistanceMeters;
        diagnostics.deliveryStraightLineDistanceMeters =
          candidate.dropoffStraightLineDistanceMeters;
        diagnostics.serviceZoneMaximumRouteDistanceMeters =
          candidate.maximumRouteDistanceMeters;
      }
      if (commonCoverageWithoutPricing) {
        throw new BadRequestException({
          code: 'order_service_zone_pricing_unavailable',
          message: 'منطقة الخدمة المحددة لا تحتوي على قاعدة تسعير نشطة حالياً.',
        });
      }
      if (
        candidates.some((candidate) => candidate.pickupInside) &&
        candidates.some((candidate) => candidate.dropoffInside)
      ) {
        throw new BadRequestException({
          code: 'order_pickup_delivery_zone_mismatch',
          message:
            'فرع الاستلام وموقع التسليم غير مشمولين داخل منطقة خدمة واحدة.',
        });
      }
      throw new BadRequestException({
        code: 'order_outside_service_zone',
        message: 'موقع التسليم خارج نطاق الخدمة.',
      });
    }
    return zone;
  }

  private async zoneCandidates(
    transaction: Transaction,
    pickup: PointRow,
    dropoff: PointRow,
  ): Promise<ZoneCandidateRow[]> {
    return transaction.$queryRaw<ZoneCandidateRow[]>`
      SELECT
        z."id", z."name", z."countryCode", z."governorate", z."city",
        z."centerLatitude"::double precision AS "centerLatitude",
        z."centerLongitude"::double precision AS "centerLongitude",
        z."radiusKm"::double precision AS "radiusKm",
        z."status", z."allowedPickup", z."allowedDropoff",
        z."maximumRouteDistanceMeters", z."priority", z."version",
        ST_DWithin(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),
            4326
          )::geography,
          z."radiusKm"::double precision * 1000
        ) AS "pickupInside",
        ST_DWithin(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${dropoff.longitude}, ${dropoff.latitude}),
            4326
          )::geography,
          z."radiusKm"::double precision * 1000
        ) AS "dropoffInside",
        ST_Distance(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),
            4326
          )::geography
        ) AS "pickupStraightLineDistanceMeters",
        ST_Distance(
          ST_SetSRID(
            ST_MakePoint(
              z."centerLongitude"::double precision,
              z."centerLatitude"::double precision
            ),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${dropoff.longitude}, ${dropoff.latitude}),
            4326
          )::geography
        ) AS "dropoffStraightLineDistanceMeters",
        EXISTS (
          SELECT 1
          FROM "PricingRule" pr
          WHERE pr."vehicleType" = 'MOTORCYCLE'
            AND pr."status" = 'ACTIVE'
            AND pr."effectiveFrom" <= NOW()
            AND (pr."effectiveTo" IS NULL OR pr."effectiveTo" > NOW())
            AND (
              pr."serviceZoneId" = z."id"
              OR (
                pr."serviceZoneId" IS NULL
                AND pr."countryCode" = z."countryCode"
                AND pr."governorate" = z."governorate"
                AND pr."city" = z."city"
              )
            )
        ) AS "pricingAvailable"
      FROM "ServiceZone" z
      WHERE z."status" = 'ACTIVE'
        AND z."allowedPickup" = true
        AND z."allowedDropoff" = true
      ORDER BY z."priority" DESC, z."name" ASC
    `;
  }

  private async resolveRule(transaction: Transaction, zone: ZoneRow) {
    const rules = await transaction.pricingRule.findMany({
      where: {
        vehicleType: 'MOTORCYCLE',
        status: 'ACTIVE',
        effectiveFrom: { lte: new Date() },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
          {
            OR: [
              { serviceZoneId: zone.id },
              {
                serviceZoneId: null,
                countryCode: zone.countryCode,
                governorate: zone.governorate,
                city: zone.city,
              },
            ],
          },
        ],
      },
    });
    const rule = resolvePricingRule(rules, { serviceZoneId: zone.id });
    if (!rule) {
      throw new BadRequestException({
        code: 'order_service_zone_pricing_unavailable',
        message: 'منطقة الخدمة المحددة لا تحتوي على قاعدة تسعير نشطة حالياً.',
      });
    }
    return rule;
  }

  private quoteDiagnostics(input: QuoteRequest): QuoteDiagnostics {
    const directDropoff =
      'addressId' in input.dropoff ? undefined : input.dropoff;
    return {
      selectedStoreId: input.storeId,
      branchLatitude: null,
      branchLongitude: null,
      pickupAddressLatitude: null,
      pickupAddressLongitude: null,
      deliveryLatitude: directDropoff?.latitude ?? null,
      deliveryLongitude: directDropoff?.longitude ?? null,
      selectedMapMarkerLatitude: directDropoff?.latitude ?? null,
      selectedMapMarkerLongitude: directDropoff?.longitude ?? null,
      locationSource: directDropoff?.locationSource ?? 'SAVED_ADDRESS',
      resolvedServiceZoneId: null,
      resolvedServiceZoneName: null,
      zoneCenterLatitude: null,
      zoneCenterLongitude: null,
      zoneRadiusKm: null,
      zoneActiveStatus: null,
      pickupStraightLineDistanceMeters: null,
      deliveryStraightLineDistanceMeters: null,
      actualRouteDistanceMeters: null,
      serviceZoneMaximumRouteDistanceMeters: null,
      pricingRuleMaximumRouteDistanceMeters: null,
      maximumRouteDistanceMeters: null,
      candidateServiceZoneId: null,
      candidateServiceZoneName: null,
      candidatePickupInside: null,
      candidateDeliveryInside: null,
      candidatePricingAvailable: null,
      finalValidationFailureCode: null,
    };
  }

  private applyResolvedZoneDiagnostics(
    diagnostics: QuoteDiagnostics,
    zone: ZoneRow,
  ): void {
    diagnostics.resolvedServiceZoneId = zone.id;
    diagnostics.resolvedServiceZoneName = zone.name;
    diagnostics.zoneCenterLatitude = zone.centerLatitude;
    diagnostics.zoneCenterLongitude = zone.centerLongitude;
    diagnostics.zoneRadiusKm = zone.radiusKm;
    diagnostics.zoneActiveStatus = zone.status;
    diagnostics.pickupStraightLineDistanceMeters =
      zone.pickupStraightLineDistanceMeters;
    diagnostics.deliveryStraightLineDistanceMeters =
      zone.dropoffStraightLineDistanceMeters;
    diagnostics.serviceZoneMaximumRouteDistanceMeters =
      zone.maximumRouteDistanceMeters;
  }

  private quoteFailureCode(error: unknown): string | undefined {
    if (!(error instanceof HttpException)) return undefined;
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      return response.code;
    }
    return undefined;
  }

  private debugQuoteDiagnostics(diagnostics: QuoteDiagnostics): void {
    if (this.environment.NODE_ENV !== 'development') return;
    this.logger.debug({
      event: 'order.quote.diagnostics',
      ...diagnostics,
    });
  }

  private async resolveFinancialSetting(transaction: Transaction) {
    const setting = await transaction.platformFinancialSetting.findFirst({
      where: { effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    if (!setting) {
      throw new ConflictException(
        'No active platform financial setting is available.',
      );
    }
    return setting;
  }

  private pricingRuleSnapshot(
    rule: Awaited<ReturnType<OrdersService['resolveRule']>>,
  ): PricingRuleSnapshot {
    const weightBands = rule.weightBands as Array<{
      upToGrams: number;
      surchargeMinor: number;
    }>;
    return {
      baseFeeMinor: rule.baseFeeMinor,
      includedDistanceMeters: rule.includedDistanceMeters,
      perKilometerMinor: rule.perKilometerMinor,
      minimumFeeMinor: rule.minimumFeeMinor,
      smallPackageSurchargeMinor: rule.smallPackageSurchargeMinor,
      mediumPackageSurchargeMinor: rule.mediumPackageSurchargeMinor,
      largePackageSurchargeMinor: rule.largePackageSurchargeMinor,
      weightBands,
      fragileSurchargeMinor: rule.fragileSurchargeMinor,
      thermalBagSurchargeMinor: rule.thermalBagSurchargeMinor,
      commissionType: rule.commissionType,
      commissionValue: rule.commissionValue,
      taxBasisPoints: rule.taxBasisPoints,
      returnTripPercentageBasisPoints: rule.returnTripPercentageBasisPoints,
    };
  }

  private addressSnapshot(
    address: {
      id: string;
      label: string | null;
      contactName: string;
      contactPhone: string;
      addressLine: string;
      street: string | null;
      buildingNumber: string | null;
      floor: string | null;
      apartment: string | null;
      landmark: string | null;
      area: string;
      city: string;
      governorate: string;
      instructions: string | null;
      deliveryNotes: string | null;
      sourceMapsUrl: string | null;
      latitude: { toString(): string };
      longitude: { toString(): string };
    },
    locationSource: string,
  ) {
    return {
      id: address.id,
      label: address.label,
      contactName: address.contactName,
      contactPhone: address.contactPhone,
      addressLine: address.addressLine,
      street: address.street,
      buildingNumber: address.buildingNumber,
      floor: address.floor,
      apartment: address.apartment,
      landmark: address.landmark,
      area: address.area,
      city: address.city,
      governorate: address.governorate,
      instructions: address.instructions,
      deliveryNotes: address.deliveryNotes,
      sourceMapsUrl: address.sourceMapsUrl,
      locationSource,
      latitude: Number(address.latitude),
      longitude: Number(address.longitude),
    };
  }

  private async revalidateZone(
    transaction: Transaction,
    quote: {
      serviceZoneId: string;
      distanceMeters: number;
      pickupAddressSnapshot: Prisma.JsonValue;
      dropoffAddressSnapshot: Prisma.JsonValue;
      serviceZone: {
        status: string;
        allowedPickup: boolean;
        allowedDropoff: boolean;
        maximumRouteDistanceMeters: number;
      };
    },
  ) {
    if (
      quote.serviceZone.status !== 'ACTIVE' ||
      !quote.serviceZone.allowedPickup ||
      !quote.serviceZone.allowedDropoff ||
      quote.distanceMeters > quote.serviceZone.maximumRouteDistanceMeters
    ) {
      throw new ConflictException('The quote service zone is no longer valid.');
    }
    const pickup = quote.pickupAddressSnapshot as PointRow;
    const dropoff = quote.dropoffAddressSnapshot as PointRow;
    const rows = await transaction.$queryRaw<Array<{ valid: boolean }>>`
      SELECT (
        ST_DWithin(
          ST_SetSRID(
            ST_MakePoint("centerLongitude"::double precision, "centerLatitude"::double precision),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${pickup.longitude}, ${pickup.latitude}),
            4326
          )::geography,
          "radiusKm"::double precision * 1000
        )
        AND ST_DWithin(
          ST_SetSRID(
            ST_MakePoint("centerLongitude"::double precision, "centerLatitude"::double precision),
            4326
          )::geography,
          ST_SetSRID(
            ST_MakePoint(${dropoff.longitude}, ${dropoff.latitude}),
            4326
          )::geography,
          "radiusKm"::double precision * 1000
        )
      ) AS "valid"
      FROM "ServiceZone"
      WHERE "id" = ${quote.serviceZoneId}::uuid
    `;
    if (!rows[0]?.valid) {
      throw new ConflictException('The quote service zone has changed.');
    }
  }

  private event(
    orderId: string,
    eventType:
      | 'ORDER_DRAFT_CREATED'
      | 'QUOTE_CREATED'
      | 'ORDER_CONFIRMED'
      | 'COURIER_SEARCH_REQUESTED',
    fromStatus: 'DRAFT' | 'QUOTED' | 'SEARCHING_COURIER' | null,
    toStatus: 'DRAFT' | 'QUOTED' | 'SEARCHING_COURIER',
    actor: { userId: string; role: Role },
    merchantMessage: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return {
      orderId,
      eventType,
      fromStatus,
      toStatus,
      actorType: 'USER' as const,
      actorId: actor.userId,
      actorRole: databaseRoleByRole[actor.role],
      source: 'MERCHANT_WEB' as const,
      merchantMessage,
      metadata,
    };
  }

  private async uniqueOrderNumber(transaction: Transaction) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const orderNumber = createOrderNumber();
      const found = await transaction.deliveryOrder.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (!found) return orderNumber;
    }
    throw new ConflictException('Could not allocate an order number.');
  }

  private async enforceRateLimit(
    action: string,
    userId: string,
    limit: number,
  ) {
    const window = Math.floor(Date.now() / 60_000);
    const key = `phase2:rate:${action}:${userId}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 70);
    if (count > limit) {
      throw new HttpException('Too many requests. Try again shortly.', 429);
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
  ) {
    await transaction.idempotencyRecord.update({
      where: { scope_key: { scope, key } },
      data: {
        status: 'COMPLETED',
        responseCode: 200,
        responseBody: { entityId },
      },
    });
  }

  private async idempotencyReplay(
    scope: string,
    key: string,
    fingerprint: string,
  ) {
    const record = await this.database.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!record) return undefined;
    if (record.requestHash !== fingerprint) {
      throw new ConflictException(
        'The idempotency key was reused with different data.',
      );
    }
    const body = record.responseBody as { entityId?: string } | null;
    if (record.status === 'COMPLETED' && body?.entityId) {
      return body.entityId;
    }
    throw new ConflictException('The request is already processing.');
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
