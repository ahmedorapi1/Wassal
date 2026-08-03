import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@wasel/contracts';
import type {
  OrderStatus,
  Prisma,
  PrismaClient,
  UserRole,
} from '@wasel/database';

import { writeAudit } from '../infrastructure/audit.js';
import { databaseRoleByRole } from '../infrastructure/request.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { overlappingRulePairs } from '../orders/order-domain.js';
import {
  cairoPeriodBounds,
  pricingRemovalDecision,
} from './admin-operations-domain.js';
import {
  automaticCircleBounds,
  circleFromLegacyGeometry,
  type ZoneCenter,
} from './service-zone-geometry.js';

type AdminActor = { userId: string; role: Role };

const orderStatusGroups = {
  NEW: ['DRAFT', 'QUOTED'],
  AVAILABLE: [
    'SEARCHING_COURIER',
    'NO_COURIER_AVAILABLE',
    'NO_COURIER_AVAILABLE_FINAL',
  ],
  ACCEPTED: ['COURIER_ASSIGNED'],
  PICKING_UP: ['COURIER_ARRIVING_PICKUP', 'AT_PICKUP'],
  IN_DELIVERY: ['PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'],
  COMPLETED_GROUP: ['DELIVERED', 'COMPLETED'],
  RETURNED_GROUP: [
    'DELIVERY_FAILED',
    'RETURNING_TO_STORE',
    'RETURN_AWAITING_MERCHANT_CONFIRMATION',
    'RETURNED',
  ],
  CANCELLED_GROUP: ['CANCELLED'],
  DISPUTED: ['DELIVERY_DISPUTED'],
} as const satisfies Record<string, readonly OrderStatus[]>;

type OrderStatusGroup = keyof typeof orderStatusGroups;

type ZoneInput = {
  name: string;
  countryCode: string;
  governorate: string;
  city: string;
  centerLatitude?: number;
  centerLongitude?: number;
  radiusKm?: number;
  geometry?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  };
  allowedPickup: boolean;
  allowedDropoff: boolean;
  maximumRouteDistanceMeters: number;
  priority: number;
};

type ZoneUpdateInput = Partial<ZoneInput> & {
  status?: 'ACTIVE' | 'INACTIVE';
  version: number;
};

type ServiceZoneRecord = {
  id: string;
  name: string;
  countryCode: string;
  governorate: string;
  city: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  status: 'ACTIVE' | 'INACTIVE';
  allowedPickup: boolean;
  allowedDropoff: boolean;
  maximumRouteDistanceMeters: number;
  priority: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  geometry: unknown;
};

type ServiceZoneDeleteReferences = {
  auditRecords: number;
  courierMemberships: number;
  ledgerEntries: number;
  merchantBranches: number;
  notifications: number;
  orders: number;
  priceQuotes: number;
  pricingRules: number;
  settlementLines: number;
};

export const serviceZoneDeleteBlockedMessage =
  'لا يمكن حذف منطقة الخدمة لأنها مرتبطة بفروع أو طلبات أو قواعد تسعير. يمكنك إيقافها بدلًا من حذفها.';

export type PricingInput = {
  ruleFamilyKey?: string;
  countryCode: string;
  governorate: string;
  city: string;
  serviceZoneId?: string;
  vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'VAN';
  currency: string;
  baseFeeMinor: number;
  includedDistanceMeters: number;
  perKilometerMinor: number;
  minimumFeeMinor: number;
  maximumDistanceMeters: number;
  smallPackageSurchargeMinor: number;
  mediumPackageSurchargeMinor: number;
  largePackageSurchargeMinor: number;
  weightBands: Array<{ upToGrams: number; surchargeMinor: number }>;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  waitingFeePerMinuteMinor: number;
  returnTripBaseMinor: number;
  returnTripPercentageBasisPoints: number;
  commissionType: 'PERCENTAGE' | 'FIXED';
  commissionValue: number;
  taxBasisPoints: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  priority: number;
};

@Injectable()
export class PhaseTwoAdminService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
  ) {}

  public async dashboard() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [
      today,
      statusGroups,
      cancelled,
      quoteTotal,
      quoteConsumed,
      quoteExpired,
      zones,
    ] = await Promise.all([
      this.database.deliveryOrder.count({
        where: { createdAt: { gte: start } },
      }),
      this.database.deliveryOrder.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.database.deliveryOrder.count({ where: { status: 'CANCELLED' } }),
      this.database.priceQuote.count(),
      this.database.priceQuote.count({ where: { status: 'CONSUMED' } }),
      this.database.priceQuote.count({ where: { status: 'EXPIRED' } }),
      this.database.serviceZone.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { orders: true } },
        },
      }),
    ]);
    return {
      ordersCreatedToday: today,
      ordersByStatus: Object.fromEntries(
        statusGroups.map((row) => [row.status, row._count]),
      ),
      cancelledOrders: cancelled,
      quoteConversionRate: quoteTotal === 0 ? 0 : quoteConsumed / quoteTotal,
      expiredQuotes: quoteExpired,
      ordersByZone: zones.map((zone) => ({
        zoneId: zone.id,
        zoneName: zone.name,
        orders: zone._count.orders,
      })),
    };
  }

  public async serviceZones() {
    const rows = await this.database.$queryRaw<ServiceZoneRecord[]>`
      SELECT
        "id", "name", "countryCode", "governorate", "city", "status",
        "centerLatitude"::double precision AS "centerLatitude",
        "centerLongitude"::double precision AS "centerLongitude",
        "radiusKm"::double precision AS "radiusKm",
        "allowedPickup", "allowedDropoff", "maximumRouteDistanceMeters",
        "priority", "version", "createdAt", "updatedAt",
        ST_AsGeoJSON("boundary"::geometry)::jsonb AS "geometry"
      FROM "ServiceZone"
      ORDER BY "priority" DESC, "name" ASC
    `;
    return rows.map((zone) => ({
      ...zone,
      bounds: automaticCircleBounds(zone),
    }));
  }

  public async serviceZone(zoneId: string) {
    const rows = await this.database.$queryRaw<ServiceZoneRecord[]>`
      SELECT
        "id", "name", "countryCode", "governorate", "city", "status",
        "centerLatitude"::double precision AS "centerLatitude",
        "centerLongitude"::double precision AS "centerLongitude",
        "radiusKm"::double precision AS "radiusKm",
        "allowedPickup", "allowedDropoff", "maximumRouteDistanceMeters",
        "priority", "version", "createdAt", "updatedAt",
        ST_AsGeoJSON("boundary"::geometry)::jsonb AS "geometry"
      FROM "ServiceZone"
      WHERE "id" = ${zoneId}::uuid
    `;
    const zone = rows[0];
    if (!zone) throw new NotFoundException('منطقة الخدمة غير موجودة.');
    return {
      ...zone,
      bounds: automaticCircleBounds(zone),
    };
  }

  public async createServiceZone(actor: AdminActor, input: ZoneInput) {
    const id = randomUUID();
    const circle = this.circleForInput(input);
    try {
      await this.database.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          INSERT INTO "ServiceZone" (
            "id", "name", "countryCode", "governorate", "city",
            "centerLatitude", "centerLongitude", "radiusKm", "boundary",
            "status", "allowedPickup", "allowedDropoff",
            "maximumRouteDistanceMeters", "priority", "updatedAt"
          )
          VALUES (
            ${id}::uuid, ${input.name}, ${input.countryCode},
            ${input.governorate}, ${input.city},
            ${circle.centerLatitude}, ${circle.centerLongitude}, ${circle.radiusKm},
            ST_Multi(
              ST_Buffer(
                ST_SetSRID(
                  ST_MakePoint(${circle.centerLongitude}, ${circle.centerLatitude}),
                  4326
                )::geography,
                ${circle.radiusKm} * 1000
              )::geometry
            )::geography,
            'INACTIVE', ${input.allowedPickup}, ${input.allowedDropoff},
            ${input.maximumRouteDistanceMeters}, ${input.priority}, NOW()
          )
        `;
        await this.audit(transaction, actor, 'service_zone.created', id, {
          center: {
            latitude: circle.centerLatitude,
            longitude: circle.centerLongitude,
          },
          radiusKm: circle.radiusKm,
          maximumRouteDistanceMeters: input.maximumRouteDistanceMeters,
          status: 'INACTIVE',
        });
      });
    } catch (error) {
      if (this.isDuplicateZoneError(error)) {
        throw new ConflictException(
          'توجد منطقة فعّالة أخرى بالاسم والمركز ونصف القطر نفسها.',
        );
      }
      throw new BadRequestException(
        'تعذر حفظ منطقة الخدمة. راجع المركز ونصف القطر وبقية البيانات.',
      );
    }
    return this.serviceZone(id);
  }

  public async updateServiceZone(
    actor: AdminActor,
    zoneId: string,
    input: ZoneUpdateInput,
  ) {
    const current = await this.serviceZone(zoneId);
    const circle = this.circleForUpdate(current, input);
    const candidate = {
      name: input.name ?? current.name,
      countryCode: input.countryCode ?? current.countryCode,
      governorate: input.governorate ?? current.governorate,
      city: input.city ?? current.city,
      allowedPickup: input.allowedPickup ?? current.allowedPickup,
      allowedDropoff: input.allowedDropoff ?? current.allowedDropoff,
      maximumRouteDistanceMeters:
        input.maximumRouteDistanceMeters ?? current.maximumRouteDistanceMeters,
      priority: input.priority ?? current.priority,
      status: input.status ?? current.status,
    };
    if (candidate.status === 'ACTIVE') {
      await this.assertNoDuplicateActiveZone(zoneId, candidate.name, circle);
    }
    try {
      await this.database.$transaction(async (transaction) => {
        const changed = await transaction.$executeRaw`
          UPDATE "ServiceZone"
          SET
            "name" = ${candidate.name},
            "countryCode" = ${candidate.countryCode},
            "governorate" = ${candidate.governorate},
            "city" = ${candidate.city},
            "centerLatitude" = ${circle.centerLatitude},
            "centerLongitude" = ${circle.centerLongitude},
            "radiusKm" = ${circle.radiusKm},
            "boundary" = ST_Multi(
              ST_Buffer(
                ST_SetSRID(
                  ST_MakePoint(${circle.centerLongitude}, ${circle.centerLatitude}),
                  4326
                )::geography,
                ${circle.radiusKm} * 1000
              )::geometry
            )::geography,
            "allowedPickup" = ${candidate.allowedPickup},
            "allowedDropoff" = ${candidate.allowedDropoff},
            "maximumRouteDistanceMeters" = ${candidate.maximumRouteDistanceMeters},
            "priority" = ${candidate.priority},
            "status" = ${candidate.status}::"ServiceZoneStatus",
            "version" = "version" + 1,
            "updatedAt" = NOW()
          WHERE "id" = ${zoneId}::uuid
            AND "version" = ${input.version}
        `;
        if (changed !== 1) {
          throw new ConflictException(
            'تغيرت منطقة الخدمة. حدّث الصفحة ثم أعد المحاولة.',
          );
        }
        await this.audit(transaction, actor, 'service_zone.updated', zoneId, {
          previous: {
            center: {
              latitude: current.centerLatitude,
              longitude: current.centerLongitude,
            },
            radiusKm: current.radiusKm,
            maximumRouteDistanceMeters: current.maximumRouteDistanceMeters,
            status: current.status,
          },
          next: {
            center: {
              latitude: circle.centerLatitude,
              longitude: circle.centerLongitude,
            },
            radiusKm: circle.radiusKm,
            maximumRouteDistanceMeters: candidate.maximumRouteDistanceMeters,
            status: candidate.status,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      if (this.isDuplicateZoneError(error)) {
        throw new ConflictException(
          'توجد منطقة فعّالة أخرى بالاسم والمركز ونصف القطر نفسها.',
        );
      }
      throw new BadRequestException(
        'تعذر تحديث منطقة الخدمة. راجع المركز ونصف القطر وبقية البيانات.',
      );
    }
    return this.serviceZone(zoneId);
  }

  public async setServiceZoneStatus(
    actor: AdminActor,
    zoneId: string,
    status: 'ACTIVE' | 'INACTIVE',
  ) {
    const current = await this.serviceZone(zoneId);
    if (status === current.status) return current;
    if (status === 'ACTIVE') {
      await this.assertNoDuplicateActiveZone(zoneId, current.name, current);
    }
    try {
      await this.database.$transaction(async (transaction) => {
        const changed = await transaction.serviceZone.updateMany({
          where: { id: zoneId, version: current.version },
          data: { status, version: { increment: 1 } },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'تغيرت منطقة الخدمة. حدّث الصفحة ثم أعد المحاولة.',
          );
        }
        await this.audit(
          transaction,
          actor,
          `service_zone.${status.toLowerCase()}`,
          zoneId,
          {
            previousStatus: current.status,
            newStatus: status,
          },
        );
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (this.isDuplicateZoneError(error)) {
        throw new ConflictException(
          'توجد منطقة فعّالة أخرى بالاسم والمركز ونصف القطر نفسها.',
        );
      }
      throw error;
    }
    return this.serviceZone(zoneId);
  }

  public async deleteServiceZone(actor: AdminActor, zoneId: string) {
    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<
        Array<{ id: string; name: string; status: 'ACTIVE' | 'INACTIVE' }>
      >`
        SELECT "id", "name", "status"
        FROM "ServiceZone"
        WHERE "id" = ${zoneId}::uuid
        FOR UPDATE
      `;
      const zone = locked[0];
      if (!zone) throw new NotFoundException('منطقة الخدمة غير موجودة.');
      if (zone.status !== 'INACTIVE') {
        throw new ConflictException(
          'لا يمكن حذف منطقة خدمة فعّالة. أوقفها أولًا، ثم أعد محاولة الحذف.',
        );
      }

      const referenceRows = await transaction.$queryRaw<
        ServiceZoneDeleteReferences[]
      >`
        SELECT
          (
            SELECT COUNT(*)::integer
            FROM "Store" store
            JOIN "ServiceZone" target ON target."id" = ${zoneId}::uuid
            WHERE store."location" IS NOT NULL
              AND ST_Covers(target."boundary", store."location")
          ) AS "merchantBranches",
          (
            SELECT COUNT(*)::integer
            FROM "DeliveryOrder"
            WHERE "serviceZoneId" = ${zoneId}::uuid
          ) AS "orders",
          (
            SELECT COUNT(*)::integer
            FROM "PriceQuote"
            WHERE "serviceZoneId" = ${zoneId}::uuid
          ) AS "priceQuotes",
          (
            SELECT COUNT(*)::integer
            FROM "PricingRule"
            WHERE "serviceZoneId" = ${zoneId}::uuid
          ) AS "pricingRules",
          (
            SELECT COUNT(*)::integer
            FROM "CourierServiceZone"
            WHERE "serviceZoneId" = ${zoneId}::uuid
          ) AS "courierMemberships",
          (
            SELECT COUNT(*)::integer
            FROM "CourierLedgerEntry" ledger
            JOIN "DeliveryOrder" orders ON orders."id" = ledger."orderId"
            WHERE orders."serviceZoneId" = ${zoneId}::uuid
          ) AS "ledgerEntries",
          (
            SELECT COUNT(*)::integer
            FROM "SettlementLine" settlement
            JOIN "CourierLedgerEntry" ledger
              ON ledger."id" = settlement."ledgerEntryId"
            JOIN "DeliveryOrder" orders ON orders."id" = ledger."orderId"
            WHERE orders."serviceZoneId" = ${zoneId}::uuid
          ) AS "settlementLines",
          (
            SELECT COUNT(*)::integer
            FROM "AuditLog"
            WHERE "entityType" = 'ServiceZone'
              AND "entityId" = ${zoneId}
          ) AS "auditRecords",
          (
            SELECT COUNT(*)::integer
            FROM "Notification"
            WHERE "relatedEntityType" = 'ServiceZone'
              AND "relatedEntityId" = ${zoneId}
          ) AS "notifications"
      `;
      const references = referenceRows[0];
      if (
        !references ||
        Object.values(references).some((count) => Number(count) > 0)
      ) {
        throw new ConflictException(serviceZoneDeleteBlockedMessage);
      }

      const deleted = await transaction.serviceZone.deleteMany({
        where: { id: zoneId, status: 'INACTIVE' },
      });
      if (deleted.count !== 1) {
        throw new ConflictException(
          'تغيرت منطقة الخدمة. حدّث الصفحة ثم أعد المحاولة.',
        );
      }
      await this.audit(transaction, actor, 'service_zone.deleted', zoneId, {
        name: zone.name,
        references,
      });
      return { deleted: true, id: zoneId };
    });
  }

  public async pricingRules(includeArchived = false) {
    const rules = await this.database.pricingRule.findMany({
      where: includeArchived ? {} : { status: { not: 'RETIRED' } },
      include: {
        serviceZone: {
          select: {
            id: true,
            name: true,
            governorate: true,
            city: true,
            status: true,
            radiusKm: true,
            maximumRouteDistanceMeters: true,
          },
        },
        _count: { select: { quotes: true, orders: true } },
      },
      orderBy: [
        { updatedAt: 'desc' },
        { ruleFamilyKey: 'asc' },
        { version: 'desc' },
      ],
    });
    const createdAudits = await this.database.auditLog.findMany({
      where: {
        entityType: 'PricingRule',
        entityId: { in: rules.map((rule) => rule.id) },
        action: {
          in: ['pricing_rule.created', 'pricing_rule.version_created'],
        },
      },
      include: {
        actor: { select: { displayName: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const creatorByRule = new Map(
      createdAudits.map((entry) => [
        entry.entityId,
        entry.actor ?? {
          displayName: 'النظام',
          role: entry.actorRole,
        },
      ]),
    );
    return rules.map((rule) => ({
      ...rule,
      createdBy: creatorByRule.get(rule.id) ?? null,
    }));
  }

  public async pricingRule(ruleId: string) {
    const rule = await this.database.pricingRule.findUnique({
      where: { id: ruleId },
      include: {
        serviceZone: {
          select: {
            id: true,
            name: true,
            governorate: true,
            city: true,
            status: true,
            radiusKm: true,
            maximumRouteDistanceMeters: true,
          },
        },
        _count: { select: { quotes: true, orders: true } },
      },
    });
    if (!rule) throw new NotFoundException('Pricing rule was not found.');
    return rule;
  }

  public async createPricingRule(actor: AdminActor, input: PricingInput) {
    const family = input.ruleFamilyKey ?? `pricing-${randomUUID()}`;
    const latest = await this.database.pricingRule.findFirst({
      where: { ruleFamilyKey: family },
      orderBy: { version: 'desc' },
    });
    const rule = await this.database.$transaction(async (transaction) => {
      const data = await this.pricingDataForZone(transaction, input);
      const created = await transaction.pricingRule.create({
        data: {
          ...data,
          ruleFamilyKey: family,
          version: (latest?.version ?? 0) + 1,
          status: 'DRAFT',
        },
      });
      await this.audit(transaction, actor, 'pricing_rule.created', created.id);
      return created;
    });
    return this.pricingRule(rule.id);
  }

  public async newPricingRuleVersion(
    actor: AdminActor,
    ruleId: string,
    overrides: Partial<PricingInput>,
  ) {
    const current = await this.database.pricingRule.findUnique({
      where: { id: ruleId },
    });
    if (!current) throw new NotFoundException('Pricing rule was not found.');
    const latest = await this.database.pricingRule.findFirstOrThrow({
      where: { ruleFamilyKey: current.ruleFamilyKey },
      orderBy: { version: 'desc' },
    });
    const data = {
      countryCode: current.countryCode,
      governorate: current.governorate,
      city: current.city,
      serviceZoneId: current.serviceZoneId ?? undefined,
      vehicleType: current.vehicleType,
      currency: current.currency,
      baseFeeMinor: current.baseFeeMinor,
      includedDistanceMeters: current.includedDistanceMeters,
      perKilometerMinor: current.perKilometerMinor,
      minimumFeeMinor: current.minimumFeeMinor,
      maximumDistanceMeters: current.maximumDistanceMeters,
      smallPackageSurchargeMinor: current.smallPackageSurchargeMinor,
      mediumPackageSurchargeMinor: current.mediumPackageSurchargeMinor,
      largePackageSurchargeMinor: current.largePackageSurchargeMinor,
      weightBands: current.weightBands as PricingInput['weightBands'],
      fragileSurchargeMinor: current.fragileSurchargeMinor,
      thermalBagSurchargeMinor: current.thermalBagSurchargeMinor,
      waitingFeePerMinuteMinor: current.waitingFeePerMinuteMinor,
      returnTripBaseMinor: current.returnTripBaseMinor,
      returnTripPercentageBasisPoints: current.returnTripPercentageBasisPoints,
      commissionType: current.commissionType,
      commissionValue: current.commissionValue,
      taxBasisPoints: current.taxBasisPoints,
      effectiveFrom: current.effectiveFrom,
      effectiveTo: current.effectiveTo ?? undefined,
      priority: current.priority,
      ...overrides,
    };
    const rule = await this.database.$transaction(async (transaction) => {
      const normalized = await this.pricingDataForZone(
        transaction,
        data as PricingInput,
      );
      const created = await transaction.pricingRule.create({
        data: {
          ...normalized,
          ruleFamilyKey: current.ruleFamilyKey,
          version: latest.version + 1,
          status: 'DRAFT',
        },
      });
      await this.audit(
        transaction,
        actor,
        'pricing_rule.version_created',
        created.id,
      );
      return created;
    });
    return this.pricingRule(rule.id);
  }

  public async setPricingStatus(
    actor: AdminActor,
    ruleId: string,
    status: 'ACTIVE' | 'INACTIVE',
  ) {
    const current = await this.database.pricingRule.findUnique({
      where: { id: ruleId },
    });
    if (!current) throw new NotFoundException('Pricing rule was not found.');
    if (status === 'ACTIVE') {
      if (!current.serviceZoneId) {
        throw new ConflictException(
          'يجب ربط قاعدة التسعير بمنطقة خدمة قبل تفعيلها.',
        );
      }
    }
    await this.database.$transaction(async (transaction) => {
      if (status === 'ACTIVE' && current.serviceZoneId) {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "ServiceZone"
          WHERE "id" = ${current.serviceZoneId}::uuid
          FOR UPDATE
        `;
        const deactivated = await transaction.pricingRule.findMany({
          where: {
            serviceZoneId: current.serviceZoneId,
            status: 'ACTIVE',
            id: { not: ruleId },
          },
          select: { id: true },
        });
        if (deactivated.length > 0) {
          await transaction.pricingRule.updateMany({
            where: { id: { in: deactivated.map((rule) => rule.id) } },
            data: { status: 'INACTIVE' },
          });
          for (const replaced of deactivated) {
            await this.audit(
              transaction,
              actor,
              'pricing_rule.inactive',
              replaced.id,
              { replacedByRuleId: ruleId },
            );
          }
        }
      }
      await transaction.pricingRule.update({
        where: { id: ruleId },
        data: { status },
      });
      await this.audit(
        transaction,
        actor,
        `pricing_rule.${status.toLowerCase()}`,
        ruleId,
      );
    });
    return this.pricingRule(ruleId);
  }

  public async archivePricingRule(actor: AdminActor, ruleId: string) {
    const current = await this.database.pricingRule.findUnique({
      where: { id: ruleId },
    });
    if (!current) throw new NotFoundException('Pricing rule was not found.');
    if (current.status === 'ACTIVE') {
      throw new ConflictException(
        'أوقف قاعدة التسعير قبل أرشفتها حتى لا تتأثر الطلبات الجديدة.',
      );
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.pricingRule.update({
        where: { id: ruleId },
        data: { status: 'RETIRED' },
      });
      await this.audit(transaction, actor, 'pricing_rule.archived', ruleId);
    });
    return this.pricingRule(ruleId);
  }

  public async deletePricingRule(actor: AdminActor, ruleId: string) {
    const current = await this.database.pricingRule.findUnique({
      where: { id: ruleId },
      include: { _count: { select: { quotes: true, orders: true } } },
    });
    if (!current) throw new NotFoundException('Pricing rule was not found.');
    const removal = pricingRemovalDecision({
      status: current.status,
      quoteCount: current._count.quotes,
      orderCount: current._count.orders,
    });
    if (removal === 'BLOCK_ACTIVE') {
      throw new ConflictException(
        'لا يمكن حذف قاعدة تسعير نشطة. أوقفها أولاً.',
      );
    }
    if (removal === 'ARCHIVE_USED') {
      const archived = await this.archivePricingRule(actor, ruleId);
      return {
        deleted: false,
        archived: true,
        rule: archived,
        message:
          'لا يمكن حذف قاعدة تسعير مستخدمة في طلبات سابقة حفاظاً على السجلات المالية، لكن يمكن أرشفتها وإخفاؤها من الاستخدام الجديد.',
      };
    }
    return this.database.$transaction(async (transaction) => {
      const deleted = await transaction.pricingRule.deleteMany({
        where: { id: ruleId, status: { not: 'ACTIVE' } },
      });
      if (deleted.count !== 1) {
        throw new ConflictException(
          'تغيرت قاعدة التسعير. حدّث الصفحة ثم أعد المحاولة.',
        );
      }
      await this.audit(transaction, actor, 'pricing_rule.deleted', ruleId, {
        ruleFamilyKey: current.ruleFamilyKey,
        version: current.version,
      });
      return { deleted: true, archived: false, id: ruleId };
    });
  }

  public async validatePricingOverlaps(candidateId?: string) {
    const rules = await this.database.pricingRule.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          ...(candidateId ? [{ id: candidateId }] : []),
        ],
      },
    });
    return overlappingRulePairs(rules).map(([left, right]) => ({
      leftRuleId: left.id,
      rightRuleId: right.id,
      serviceZoneId: left.serviceZoneId,
      priority: left.priority,
    }));
  }

  public async orders(input: {
    page: number;
    pageSize: number;
    orderNumber?: string;
    merchantId?: string;
    storeId?: string;
    customerPhone?: string;
    status?: string;
    statusGroup?: OrderStatusGroup;
    serviceZoneId?: string;
    courierId?: string;
    cancellationReason?: string;
    createdFrom?: Date;
    createdTo?: Date;
  }) {
    const where: Prisma.DeliveryOrderWhereInput = {
      ...(input.orderNumber
        ? {
            orderNumber: {
              contains: input.orderNumber,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(input.merchantId ? { merchantId: input.merchantId } : {}),
      ...(input.storeId ? { storeId: input.storeId } : {}),
      ...(input.customerPhone
        ? {
            customer: {
              normalizedPhone: { contains: input.customerPhone },
            },
          }
        : {}),
      ...(input.status
        ? { status: input.status as OrderStatus }
        : input.statusGroup
          ? { status: { in: [...orderStatusGroups[input.statusGroup]] } }
          : {}),
      ...(input.serviceZoneId ? { serviceZoneId: input.serviceZoneId } : {}),
      ...(input.courierId ? { courierId: input.courierId } : {}),
      ...(input.cancellationReason
        ? { cancellationReasonCode: input.cancellationReason }
        : {}),
      ...(input.createdFrom || input.createdTo
        ? {
            createdAt: {
              ...(input.createdFrom ? { gte: input.createdFrom } : {}),
              ...(input.createdTo ? { lte: input.createdTo } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.deliveryOrder.findMany({
        where,
        include: {
          merchant: { select: { id: true, displayName: true } },
          store: { select: { id: true, name: true } },
          customer: {
            select: { id: true, name: true, normalizedPhone: true },
          },
          courier: { select: { id: true, fullName: true } },
          deliveryDispute: { select: { status: true } },
          serviceZone: { select: { id: true, name: true } },
          events: {
            where: { eventType: 'COURIER_ACCEPTED' },
            select: { createdAt: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.deliveryOrder.count({ where }),
    ]);
    return {
      items: items.map((order) => ({
        ...order,
        courierAcceptedAt: order.events[0]?.createdAt ?? null,
        customer: order.customer
          ? {
              ...order.customer,
              normalizedPhone: this.maskPhone(order.customer.normalizedPhone),
            }
          : null,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  public async orderZoneDashboard() {
    const { todayStart, tomorrowStart } = cairoPeriodBounds();
    const zones = await this.database.serviceZone.findMany({
      orderBy: [{ governorate: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        city: true,
        governorate: true,
        status: true,
      },
    });
    const activeStatuses = [
      'SEARCHING_COURIER',
      'NO_COURIER_AVAILABLE',
      'NO_COURIER_AVAILABLE_FINAL',
      'COURIER_ASSIGNED',
      'COURIER_ARRIVING_PICKUP',
      'AT_PICKUP',
      'PICKED_UP',
      'IN_TRANSIT',
      'AT_DROPOFF',
      'DELIVERY_DISPUTED',
      'DELIVERY_FAILED',
      'RETURNING_TO_STORE',
      'RETURN_AWAITING_MERCHANT_CONFIRMATION',
    ] as const;
    const [today, active, completedToday, returnedToday] = await Promise.all([
      this.database.deliveryOrder.groupBy({
        by: ['serviceZoneId'],
        where: { createdAt: { gte: todayStart, lt: tomorrowStart } },
        _count: { _all: true },
      }),
      this.database.deliveryOrder.groupBy({
        by: ['serviceZoneId'],
        where: { status: { in: [...activeStatuses] } },
        _count: { _all: true },
      }),
      this.database.deliveryOrder.groupBy({
        by: ['serviceZoneId'],
        where: { completedAt: { gte: todayStart, lt: tomorrowStart } },
        _count: { _all: true },
      }),
      this.database.deliveryOrder.groupBy({
        by: ['serviceZoneId'],
        where: {
          returnConfirmedAt: { gte: todayStart, lt: tomorrowStart },
        },
        _count: { _all: true },
      }),
    ]);
    const countMap = (
      rows: Array<{ serviceZoneId: string; _count: { _all: number } }>,
    ) => new Map(rows.map((row) => [row.serviceZoneId, row._count._all]));
    const todayMap = countMap(today);
    const activeMap = countMap(active);
    const completedMap = countMap(completedToday);
    const returnedMap = countMap(returnedToday);
    return {
      timezone: 'Africa/Cairo',
      zones: zones.map((zone) => ({
        ...zone,
        ordersToday: todayMap.get(zone.id) ?? 0,
        activeOrders: activeMap.get(zone.id) ?? 0,
        completedToday: completedMap.get(zone.id) ?? 0,
        returnedToday: returnedMap.get(zone.id) ?? 0,
      })),
    };
  }

  public async orderZoneSummary(serviceZoneId: string) {
    const zone = await this.database.serviceZone.findUnique({
      where: { id: serviceZoneId },
      select: {
        id: true,
        name: true,
        city: true,
        governorate: true,
        status: true,
      },
    });
    if (!zone) throw new NotFoundException('Service zone was not found.');
    const grouped = await this.database.deliveryOrder.groupBy({
      by: ['status'],
      where: { serviceZoneId },
      _count: { _all: true },
    });
    return {
      zone,
      counts: Object.fromEntries(
        Object.entries(orderStatusGroups).map(([group, statuses]) => [
          group,
          statuses.reduce(
            (total, status) =>
              total +
              (grouped.find((row) => row.status === status)?._count._all ?? 0),
            0,
          ),
        ]),
      ),
    };
  }

  public async order(actor: AdminActor, orderId: string) {
    const order = await this.database.deliveryOrder.findUnique({
      where: { id: orderId },
      include: {
        merchant: { select: { id: true, displayName: true } },
        store: { select: { id: true, name: true, status: true } },
        serviceZone: { select: { id: true, name: true, status: true } },
        pricingRule: true,
        courier: {
          select: {
            id: true,
            fullName: true,
            user: { select: { displayName: true, phone: true } },
          },
        },
        cancelledBy: {
          select: { id: true, displayName: true, role: true },
        },
        courierLedgerEntries: {
          select: {
            id: true,
            type: true,
            amountMinor: true,
            currency: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: 'asc' },
        },
        deliveryDispute: {
          select: {
            status: true,
            merchantReason: true,
            merchantNote: true,
            courierResponse: true,
            resolutionNote: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
        events: {
          include: {
            actor: { select: { id: true, displayName: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Order was not found.');
    await this.database.$transaction((transaction) =>
      this.audit(transaction, actor, 'admin_order.viewed', orderId),
    );
    const audit = await this.database.auditLog.findMany({
      where: { entityType: 'DeliveryOrder', entityId: orderId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...order,
      audit: audit.map(({ id, ...entry }) => ({
        id: id.toString(),
        ...entry,
      })),
    };
  }

  public async orderEvents(orderId: string) {
    const order = await this.database.deliveryOrder.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order was not found.');
    return this.database.orderEvent.findMany({
      where: { orderId },
      include: {
        actor: { select: { id: true, displayName: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private circleForInput(input: ZoneInput): ZoneCenter {
    if (
      input.centerLatitude !== undefined &&
      input.centerLongitude !== undefined &&
      input.radiusKm !== undefined
    ) {
      return this.validCircle({
        centerLatitude: input.centerLatitude,
        centerLongitude: input.centerLongitude,
        radiusKm: input.radiusKm,
      });
    }
    if (input.geometry) {
      return this.validCircle(circleFromLegacyGeometry(input.geometry));
    }
    throw new BadRequestException(
      'اختر مركز منطقة الخدمة ونصف قطرها على الخريطة.',
    );
  }

  private circleForUpdate(
    current: ServiceZoneRecord,
    input: ZoneUpdateInput,
  ): ZoneCenter {
    if (input.geometry && input.centerLatitude === undefined) {
      return this.validCircle(circleFromLegacyGeometry(input.geometry));
    }
    return this.validCircle({
      centerLatitude: input.centerLatitude ?? current.centerLatitude,
      centerLongitude: input.centerLongitude ?? current.centerLongitude,
      radiusKm: input.radiusKm ?? current.radiusKm,
    });
  }

  private validCircle(circle: ZoneCenter): ZoneCenter {
    if (
      !Number.isFinite(circle.centerLatitude) ||
      circle.centerLatitude < -90 ||
      circle.centerLatitude > 90 ||
      !Number.isFinite(circle.centerLongitude) ||
      circle.centerLongitude < -180 ||
      circle.centerLongitude > 180 ||
      !Number.isFinite(circle.radiusKm) ||
      circle.radiusKm <= 0 ||
      circle.radiusKm > 500
    ) {
      throw new BadRequestException('مركز المنطقة أو نصف قطرها غير صالح.');
    }
    return circle;
  }

  private async assertNoDuplicateActiveZone(
    zoneId: string,
    name: string,
    circle: ZoneCenter,
  ) {
    const duplicates = await this.database.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ServiceZone"
      WHERE "id" <> ${zoneId}::uuid
        AND "status" = 'ACTIVE'
        AND lower("name") = lower(${name})
        AND "centerLatitude" = ${circle.centerLatitude}
        AND "centerLongitude" = ${circle.centerLongitude}
        AND "radiusKm" = ${circle.radiusKm}
      LIMIT 1
    `;
    if (duplicates.length > 0) {
      throw new ConflictException(
        'توجد منطقة فعّالة أخرى بالاسم والمركز ونصف القطر نفسها.',
      );
    }
  }

  private isDuplicateZoneError(error: unknown) {
    const code = (error as { code?: string })?.code;
    return code === '23505' || code === 'P2002';
  }

  private async pricingDataForZone(
    transaction: Prisma.TransactionClient,
    input: PricingInput,
  ): Promise<PricingInput> {
    if (!input.serviceZoneId) {
      throw new BadRequestException(
        'اختر منطقة خدمة لقاعدة التسعير. لا تُنشأ قواعد على مستوى المدينة.',
      );
    }
    const zone = await transaction.serviceZone.findUnique({
      where: { id: input.serviceZoneId },
      select: {
        id: true,
        countryCode: true,
        governorate: true,
        city: true,
        maximumRouteDistanceMeters: true,
      },
    });
    if (!zone) {
      throw new NotFoundException('منطقة الخدمة المختارة غير موجودة.');
    }
    return {
      ...input,
      countryCode: zone.countryCode,
      governorate: zone.governorate,
      city: zone.city,
      serviceZoneId: zone.id,
      vehicleType: 'MOTORCYCLE',
      currency: 'EGP',
      minimumFeeMinor: input.baseFeeMinor,
      maximumDistanceMeters: zone.maximumRouteDistanceMeters,
      smallPackageSurchargeMinor: 0,
      mediumPackageSurchargeMinor: 0,
      largePackageSurchargeMinor: 0,
      waitingFeePerMinuteMinor: 0,
      returnTripBaseMinor: 0,
      returnTripPercentageBasisPoints:
        input.returnTripPercentageBasisPoints ?? 7_000,
      taxBasisPoints: 0,
      priority: 0,
      weightBands:
        input.weightBands.length > 0
          ? input.weightBands
          : [{ upToGrams: 25_000, surchargeMinor: 0 }],
    };
  }

  private audit(
    transaction: Prisma.TransactionClient,
    actor: AdminActor,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return writeAudit(transaction, {
      actorId: actor.userId,
      actorRole: databaseRoleByRole[actor.role] as UserRole,
      action,
      entityType: action.startsWith('pricing')
        ? 'PricingRule'
        : action.startsWith('service_zone')
          ? 'ServiceZone'
          : 'DeliveryOrder',
      entityId,
      metadata,
    });
  }

  private maskPhone(phone: string): string {
    return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
  }
}
