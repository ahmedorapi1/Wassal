import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@wasel/contracts';
import type {
  CourierSettlementStatus,
  ExternalPaymentMethod,
  Prisma,
  PrismaClient,
} from '@wasel/database';

import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { databaseRoleByRole } from '../infrastructure/request.js';
import { requestFingerprint } from '../orders/order-domain.js';
import {
  allocateOldestSettlements,
  daysRemaining,
  settlementStatus,
} from './finance-domain.js';
import {
  attributePaymentsToZones,
  cairoPeriodBounds,
  type ZonePaymentAllocation,
  type ZoneSettlementLine,
} from '../admin/admin-operations-domain.js';
import { refreshSettlementProjection } from './settlement-projection.js';

type Transaction = Prisma.TransactionClient;
type Actor = { userId: string; role: Role };

type AccountFilters = {
  page: number;
  pageSize: number;
  courierId?: string;
  city?: string;
  serviceZoneId?: string;
  settlementStatus?: CourierSettlementStatus;
  createdFrom?: string;
  createdTo?: string;
  overdueOnly?: boolean;
  paidOnly?: boolean;
  remainingOnly?: boolean;
};

@Injectable()
export class FinanceService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
  ) {}

  public async financialSettings() {
    const now = new Date();
    const [current, history] = await Promise.all([
      this.database.platformFinancialSetting.findFirst({
        where: { effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        include: {
          createdBy: { select: { id: true, displayName: true, role: true } },
        },
      }),
      this.database.platformFinancialSetting.findMany({
        orderBy: { version: 'desc' },
        include: {
          createdBy: { select: { id: true, displayName: true, role: true } },
        },
      }),
    ]);
    if (!current) {
      throw new NotFoundException(
        'Platform financial settings were not found.',
      );
    }
    return { current, history };
  }

  public async updateFinancialSettings(
    actor: Actor,
    input: {
      version: number;
      defaultCommissionBasisPoints: number;
      settlementCycle: 'WEEKLY';
      gracePeriodDays: number;
      operationsTimezone: 'Africa/Cairo';
      effectiveFrom?: string;
    },
  ) {
    await this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "PlatformFinancialSetting"
          ORDER BY "version" DESC
          LIMIT 1
          FOR UPDATE
        `;
        const latest =
          await transaction.platformFinancialSetting.findFirstOrThrow({
            orderBy: { version: 'desc' },
          });
        if (latest.version !== input.version) {
          throw new ConflictException(
            'Financial settings changed. Reload before updating.',
          );
        }
        const effectiveFrom = input.effectiveFrom
          ? new Date(input.effectiveFrom)
          : new Date();
        const created = await transaction.platformFinancialSetting.create({
          data: {
            defaultCommissionBasisPoints: input.defaultCommissionBasisPoints,
            settlementCycle: input.settlementCycle,
            gracePeriodDays: input.gracePeriodDays,
            operationsTimezone: input.operationsTimezone,
            effectiveFrom,
            version: latest.version + 1,
            createdById: actor.userId,
          },
        });
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: 'financial_settings.version_created',
          entityType: 'PlatformFinancialSetting',
          entityId: created.id,
          before: {
            version: latest.version,
            defaultCommissionBasisPoints: latest.defaultCommissionBasisPoints,
            settlementCycle: latest.settlementCycle,
            gracePeriodDays: latest.gracePeriodDays,
            operationsTimezone: latest.operationsTimezone,
          },
          after: {
            version: created.version,
            defaultCommissionBasisPoints: created.defaultCommissionBasisPoints,
            settlementCycle: created.settlementCycle,
            gracePeriodDays: created.gracePeriodDays,
            operationsTimezone: created.operationsTimezone,
            effectiveFrom: created.effectiveFrom.toISOString(),
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return this.financialSettings();
  }

  public async courierSummary(userId: string) {
    const courier = await this.courierForUser(userId);
    return this.accountSummary(courier.id, userId);
  }

  public async courierEntries(
    userId: string,
    input: { page: number; pageSize: number },
  ) {
    const courier = await this.courierForUser(userId);
    const [items, total] = await Promise.all([
      this.database.courierLedgerEntry.findMany({
        where: { courierId: courier.id },
        include: {
          order: { select: { orderNumber: true, status: true } },
          settlementLine: {
            select: { settlementPeriodId: true },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.courierLedgerEntry.count({
        where: { courierId: courier.id },
      }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  public async courierSettlements(
    userId: string,
    input: { page: number; pageSize: number },
  ) {
    const courier = await this.courierForUser(userId);
    const [items, total] = await Promise.all([
      this.database.settlementPeriod.findMany({
        where: { courierId: courier.id },
        orderBy: { periodStart: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.settlementPeriod.count({
        where: { courierId: courier.id },
      }),
    ]);
    return {
      items: items.map((settlement) => this.withDeadline(settlement)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  public async courierSettlement(userId: string, settlementId: string) {
    const courier = await this.courierForUser(userId);
    const settlement = await this.settlementDetail(settlementId, courier.id);
    if (!settlement) {
      throw new NotFoundException('Settlement period was not found.');
    }
    return this.withDeadline(settlement);
  }

  public async courierAccounts(input: AccountFilters) {
    const where: Prisma.CourierProfileWhereInput = {
      ...(input.courierId ? { id: input.courierId } : {}),
      ...(input.city ? { preferredCity: input.city } : {}),
      ...(input.serviceZoneId
        ? {
            serviceZones: {
              some: {
                serviceZoneId: input.serviceZoneId,
                active: true,
              },
            },
          }
        : {}),
      ...(input.settlementStatus ||
      input.overdueOnly ||
      input.paidOnly ||
      input.remainingOnly
        ? {
            settlementPeriods: {
              some: {
                ...(input.settlementStatus
                  ? { status: input.settlementStatus }
                  : {}),
                ...(input.overdueOnly ? { status: 'OVERDUE' } : {}),
                ...(input.paidOnly ? { status: 'PAID' } : {}),
                ...(input.remainingOnly
                  ? { remainingAmountMinor: { gt: 0 } }
                  : {}),
              },
            },
          }
        : {}),
    };
    const [couriers, total] = await Promise.all([
      this.database.courierProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              status: true,
            },
          },
          serviceZones: {
            where: { active: true },
            include: {
              serviceZone: { select: { id: true, name: true, city: true } },
            },
          },
        },
        orderBy: { fullName: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.courierProfile.count({ where }),
    ]);
    const items = await Promise.all(
      couriers.map(async (courier) => ({
        courier,
        summary: await this.accountSummary(courier.id, courier.userId),
      })),
    );
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  public async zoneFinanceDashboard() {
    const data = await this.zoneFinanceData();
    return {
      generatedAt: new Date().toISOString(),
      timezone: 'Africa/Cairo',
      zones: data.zones.map((zone) => {
        const metrics = data.metricsByZone.get(zone.id);
        return {
          id: zone.id,
          name: zone.name,
          city: zone.city,
          governorate: zone.governorate,
          status: zone.status,
          courierCount: zone.courierMemberships.length,
          openSettlements: metrics?.openSettlements.size ?? 0,
          overdueSettlements: metrics?.overdueSettlements.size ?? 0,
          outstandingMinor: Math.max(
            0,
            (metrics?.dueMinor ?? 0) - (metrics?.paidMinor ?? 0),
          ),
          collectedTodayMinor: metrics?.collectedTodayMinor ?? 0,
          collectedMonthMinor: metrics?.collectedMonthMinor ?? 0,
          lastActivityAt: metrics?.lastActivityAt?.toISOString() ?? null,
        };
      }),
    };
  }

  public async zoneFinanceDetail(actor: Actor, serviceZoneId: string) {
    const data = await this.zoneFinanceData();
    const zone = data.zones.find((candidate) => candidate.id === serviceZoneId);
    if (!zone) throw new NotFoundException('Service zone was not found.');
    const metrics = data.metricsByZone.get(serviceZoneId);
    const courierRows = zone.courierMemberships.map((membership) => {
      const key = `${serviceZoneId}:${membership.courierId}`;
      const courier = data.metricsByZoneCourier.get(key);
      return {
        courier: membership.courier,
        settlementStatus: courier?.latestSettlementStatus ?? 'OPEN',
        dueAt: courier?.latestDueAt?.toISOString() ?? null,
        dueMinor: courier?.dueMinor ?? 0,
        paidMinor: courier?.paidMinor ?? 0,
        completedOrders: courier?.completedOrderIds.size ?? 0,
        returnedOrders: courier?.returnedOrderIds.size ?? 0,
        grossOrderValueMinor: courier
          ? [...courier.grossOrderValues.values()].reduce(
              (sum, value) => sum + value,
              0,
            )
          : 0,
        platformCommissionDueMinor: courier?.commissionDueMinor ?? 0,
        outstandingMinor: Math.max(
          0,
          (courier?.dueMinor ?? 0) - (courier?.paidMinor ?? 0),
        ),
        lastPaymentAt: courier?.lastPaymentAt?.toISOString() ?? null,
        lastActivityAt: courier?.lastActivityAt?.toISOString() ?? null,
      };
    });
    await writeAudit(this.database, {
      actorId: actor.userId,
      actorRole: databaseRoleByRole[actor.role],
      action: 'zone_finance.viewed',
      entityType: 'ServiceZone',
      entityId: serviceZoneId,
    });
    return {
      zone: {
        id: zone.id,
        name: zone.name,
        city: zone.city,
        governorate: zone.governorate,
        status: zone.status,
      },
      timezone: 'Africa/Cairo',
      summary: {
        courierCount: zone.courierMemberships.length,
        openSettlements: metrics?.openSettlements.size ?? 0,
        overdueSettlements: metrics?.overdueSettlements.size ?? 0,
        dueMinor: metrics?.dueMinor ?? 0,
        paidMinor: metrics?.paidMinor ?? 0,
        outstandingMinor: Math.max(
          0,
          (metrics?.dueMinor ?? 0) - (metrics?.paidMinor ?? 0),
        ),
        collectedTodayMinor: metrics?.collectedTodayMinor ?? 0,
        collectedMonthMinor: metrics?.collectedMonthMinor ?? 0,
      },
      couriers: courierRows.sort(
        (left, right) =>
          right.outstandingMinor - left.outstandingMinor ||
          left.courier.fullName.localeCompare(right.courier.fullName),
      ),
    };
  }

  public async adminCourierAccount(actor: Actor, courierId: string) {
    const courier = await this.database.courierProfile.findUnique({
      where: { id: courierId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            phone: true,
            status: true,
          },
        },
        serviceZones: {
          include: {
            serviceZone: { select: { id: true, name: true, city: true } },
          },
        },
      },
    });
    if (!courier) throw new NotFoundException('Courier was not found.');
    const [summary, entries, settlements, payments, audit] = await Promise.all([
      this.accountSummary(courier.id, courier.userId),
      this.database.courierLedgerEntry.findMany({
        where: { courierId },
        include: {
          order: { select: { id: true, orderNumber: true, status: true } },
          settlementLine: {
            select: { settlementPeriodId: true },
          },
          createdBy: {
            select: { id: true, displayName: true, role: true },
          },
        },
        orderBy: { occurredAt: 'desc' },
      }),
      this.database.settlementPeriod.findMany({
        where: { courierId },
        orderBy: { periodStart: 'desc' },
      }),
      this.database.externalPaymentRecord.findMany({
        where: { courierId },
        include: {
          allocations: true,
          createdBy: {
            select: { id: true, displayName: true, role: true },
          },
          reversedBy: { select: { id: true, createdAt: true } },
        },
        orderBy: { paidAt: 'desc' },
      }),
      this.database.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'CourierProfile', entityId: courierId },
            {
              entityType: {
                in: [
                  'SettlementPeriod',
                  'ExternalPaymentRecord',
                  'CourierLedgerEntry',
                ],
              },
              metadata: { path: ['courierId'], equals: courierId },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    await writeAudit(this.database, {
      actorId: actor.userId,
      actorRole: databaseRoleByRole[actor.role],
      action: 'courier_account.viewed',
      entityType: 'CourierProfile',
      entityId: courierId,
    });
    return {
      courier,
      summary,
      entries,
      settlements: settlements.map((settlement) =>
        this.withDeadline(settlement),
      ),
      payments,
      audit: audit.map((entry) => ({ ...entry, id: entry.id.toString() })),
    };
  }

  public async adminSettlements(input: AccountFilters) {
    const where: Prisma.SettlementPeriodWhereInput = {
      ...(input.courierId ? { courierId: input.courierId } : {}),
      ...(input.settlementStatus ? { status: input.settlementStatus } : {}),
      ...(input.overdueOnly ? { status: 'OVERDUE' } : {}),
      ...(input.paidOnly ? { status: 'PAID' } : {}),
      ...(input.remainingOnly ? { remainingAmountMinor: { gt: 0 } } : {}),
      ...(input.createdFrom || input.createdTo
        ? {
            periodStart: {
              ...(input.createdFrom
                ? { gte: new Date(input.createdFrom) }
                : {}),
              ...(input.createdTo ? { lte: new Date(input.createdTo) } : {}),
            },
          }
        : {}),
      ...(input.city || input.serviceZoneId
        ? {
            courier: {
              ...(input.city ? { preferredCity: input.city } : {}),
              ...(input.serviceZoneId
                ? {
                    serviceZones: {
                      some: {
                        serviceZoneId: input.serviceZoneId,
                        active: true,
                      },
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.settlementPeriod.findMany({
        where,
        include: {
          courier: {
            select: {
              id: true,
              fullName: true,
              preferredCity: true,
              verificationStatus: true,
              user: { select: { phone: true, status: true } },
            },
          },
        },
        orderBy: [{ periodStart: 'desc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.settlementPeriod.count({ where }),
    ]);
    return {
      items: items.map((settlement) => this.withDeadline(settlement)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  public async adminSettlement(settlementId: string) {
    const settlement = await this.settlementDetail(settlementId);
    if (!settlement) {
      throw new NotFoundException('Settlement period was not found.');
    }
    return this.withDeadline(settlement);
  }

  public async closeSettlement(
    actor: Actor,
    settlementId: string,
    version: number,
    idempotencyKey: string,
  ) {
    const scope = `settlement:close:${settlementId}`;
    const fingerprint = requestFingerprint({ settlementId, version });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.adminSettlement(replay);

    const id = await this.database.$transaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await transaction.$queryRaw`
          SELECT "id"
          FROM "SettlementPeriod"
          WHERE "id" = ${settlementId}::uuid
          FOR UPDATE
        `;
        const settlement = await transaction.settlementPeriod.findUnique({
          where: { id: settlementId },
        });
        if (!settlement) {
          throw new NotFoundException('Settlement period was not found.');
        }
        if (settlement.status !== 'OPEN') {
          await this.completeIdempotency(
            transaction,
            scope,
            idempotencyKey,
            settlement.id,
          );
          return settlement.id;
        }
        if (settlement.version !== version) {
          throw new ConflictException(
            'Settlement changed. Reload before closing.',
          );
        }
        const now = new Date();
        if (settlement.periodEnd > now) {
          throw new ConflictException(
            'An open weekly settlement cannot close before its period ends.',
          );
        }
        const missing = await transaction.courierLedgerEntry.findMany({
          where: {
            courierId: settlement.courierId,
            occurredAt: {
              gte: settlement.periodStart,
              lt: settlement.periodEnd,
            },
            settlementLine: null,
          },
        });
        if (missing.length > 0) {
          await transaction.settlementLine.createMany({
            data: missing.map((entry) => ({
              settlementPeriodId: settlement.id,
              ledgerEntryId: entry.id,
              amountMinor: entry.amountMinor,
            })),
            skipDuplicates: true,
          });
        }
        const projection = await refreshSettlementProjection(
          transaction,
          settlement.id,
          now,
        );
        const status = settlementStatus({
          open: false,
          remainingAmountMinor: projection.remainingAmountMinor,
          totalPaymentsMinor: projection.totalPaymentsMinor,
          totalAdjustmentsMinor: projection.totalAdjustmentsMinor,
          totalWaivedMinor: projection.totalWaivedMinor,
          dueAt: projection.dueAt,
          now,
        });
        await transaction.settlementPeriod.updateMany({
          where: { id: settlement.id, status: 'OPEN' },
          data: {
            status,
            closedAt: now,
            version: { increment: 1 },
          },
        });
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: 'settlement.closed',
          entityType: 'SettlementPeriod',
          entityId: settlement.id,
          metadata: {
            courierId: settlement.courierId,
            missingLinesAdded: missing.length,
          },
        });
        await this.completeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          settlement.id,
        );
        return settlement.id;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.adminSettlement(id);
  }

  public async recordExternalPayment(
    actor: Actor,
    courierId: string,
    input: {
      amountMinor: number;
      currency: 'EGP';
      paidAt: string;
      method: ExternalPaymentMethod;
      externalReference?: string;
      note?: string;
    },
    idempotencyKey: string,
  ) {
    const scope = `external-payment:create:${courierId}`;
    const fingerprint = requestFingerprint(input);
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.externalPayment(replay);

    const paymentId = await this.database.$transaction(
      async (transaction) =>
        (
          await this.recordExternalPaymentInTransaction(
            transaction,
            actor,
            courierId,
            input,
            idempotencyKey,
          )
        ).id,
      { isolationLevel: 'Serializable' },
    );
    return this.externalPayment(paymentId);
  }

  /**
   * The shared accounting command. Payment-proof review calls this inside its
   * own transaction so proof state and courier balance change atomically.
   */
  public async recordExternalPaymentInTransaction(
    transaction: Transaction,
    actor: Actor,
    courierId: string,
    input: {
      amountMinor: number;
      currency: 'EGP';
      paidAt: string;
      method: ExternalPaymentMethod;
      externalReference?: string;
      note?: string;
    },
    idempotencyKey: string,
  ) {
    const scope = `external-payment:create:${courierId}`;
    const fingerprint = requestFingerprint(input);
    await this.claimIdempotency(
      transaction,
      scope,
      idempotencyKey,
      fingerprint,
    );
    await this.ensureCourier(transaction, courierId);
    await transaction.$queryRaw`
          SELECT "id"
          FROM "SettlementPeriod"
          WHERE "courierId" = ${courierId}::uuid
            AND "status" <> 'OPEN'
            AND "remainingAmountMinor" > 0
          ORDER BY "periodStart" ASC, "id" ASC
          FOR UPDATE
        `;
    const settlements = await transaction.settlementPeriod.findMany({
      where: {
        courierId,
        status: { not: 'OPEN' },
        remainingAmountMinor: { gt: 0 },
      },
      orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
    });
    let allocations: Array<{
      settlementPeriodId: string;
      amountMinor: number;
    }>;
    try {
      allocations = allocateOldestSettlements(input.amountMinor, settlements);
    } catch (error) {
      if ((error as Error).message === 'overpayment') {
        throw new ConflictException(
          'Payment exceeds the courier outstanding balance.',
        );
      }
      throw error;
    }
    const payment = await transaction.externalPaymentRecord.create({
      data: {
        courierId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        paidAt: new Date(input.paidAt),
        method: input.method,
        externalReference: input.externalReference,
        note: input.note,
        createdById: actor.userId,
        idempotencyKey,
      },
    });
    await transaction.courierLedgerEntry.create({
      data: {
        courierId,
        type: 'EXTERNAL_PAYMENT',
        amountMinor: -input.amountMinor,
        currency: input.currency,
        sourceKey: `payment:${payment.id}`,
        createdById: actor.userId,
        reason: input.note ?? 'External payment recorded by administration.',
        metadata: {
          kind: 'external_payment',
          paymentId: payment.id,
          method: input.method,
          externalReference: input.externalReference ?? null,
        },
        occurredAt: new Date(input.paidAt),
      },
    });
    await transaction.externalPaymentAllocation.createMany({
      data: allocations.map((allocation) => ({
        paymentId: payment.id,
        ...allocation,
      })),
    });
    for (const allocation of allocations) {
      await refreshSettlementProjection(
        transaction,
        allocation.settlementPeriodId,
      );
    }
    await writeAudit(transaction, {
      actorId: actor.userId,
      actorRole: databaseRoleByRole[actor.role],
      action: 'external_payment.recorded',
      entityType: 'ExternalPaymentRecord',
      entityId: payment.id,
      metadata: {
        courierId,
        amountMinor: input.amountMinor,
        allocationCount: allocations.length,
      },
    });
    await this.completeIdempotency(
      transaction,
      scope,
      idempotencyKey,
      payment.id,
    );
    return payment;
  }

  public async reverseExternalPayment(
    actor: Actor,
    paymentId: string,
    idempotencyKey: string,
  ) {
    const scope = `external-payment:reverse:${paymentId}`;
    const fingerprint = requestFingerprint({ paymentId });
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) return this.externalPayment(replay);

    const reversalId = await this.database.$transaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await transaction.$queryRaw`
          SELECT "id"
          FROM "ExternalPaymentRecord"
          WHERE "id" = ${paymentId}::uuid
          FOR UPDATE
        `;
        const payment = await transaction.externalPaymentRecord.findUnique({
          where: { id: paymentId },
          include: { allocations: true, reversedBy: true },
        });
        if (!payment) {
          throw new NotFoundException('External payment was not found.');
        }
        if (payment.reversesPaymentId || payment.reversedBy) {
          throw new ConflictException(
            'This payment is already a reversal or has been reversed.',
          );
        }
        const originalEntry =
          await transaction.courierLedgerEntry.findUniqueOrThrow({
            where: { sourceKey: `payment:${payment.id}` },
          });
        const reversal = await transaction.externalPaymentRecord.create({
          data: {
            courierId: payment.courierId,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            paidAt: new Date(),
            method: 'OTHER',
            externalReference: payment.externalReference
              ? `REVERSAL:${payment.externalReference}`
              : undefined,
            note: `Reversal of external payment ${payment.id}`,
            createdById: actor.userId,
            idempotencyKey,
            reversesPaymentId: payment.id,
          },
        });
        await transaction.courierLedgerEntry.create({
          data: {
            courierId: payment.courierId,
            type: 'REVERSAL',
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            sourceKey: `payment-reversal:${reversal.id}`,
            reversesEntryId: originalEntry.id,
            createdById: actor.userId,
            reason: `Reversal of external payment ${payment.id}.`,
            metadata: {
              kind: 'external_payment_reversal',
              paymentId: payment.id,
              reversalPaymentId: reversal.id,
            },
            occurredAt: new Date(),
          },
        });
        await transaction.externalPaymentAllocation.createMany({
          data: payment.allocations.map((allocation) => ({
            paymentId: reversal.id,
            settlementPeriodId: allocation.settlementPeriodId,
            amountMinor: allocation.amountMinor,
          })),
        });
        for (const allocation of payment.allocations) {
          await refreshSettlementProjection(
            transaction,
            allocation.settlementPeriodId,
          );
        }
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: 'external_payment.reversed',
          entityType: 'ExternalPaymentRecord',
          entityId: reversal.id,
          metadata: {
            courierId: payment.courierId,
            originalPaymentId: payment.id,
          },
        });
        await this.completeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          reversal.id,
        );
        return reversal.id;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.externalPayment(reversalId);
  }

  public async createAdjustment(
    actor: Actor,
    courierId: string,
    input: {
      type: 'ADJUSTMENT_DEBIT' | 'ADJUSTMENT_CREDIT' | 'WAIVER' | 'REVERSAL';
      amountMinor: number;
      reason: string;
      settlementPeriodId?: string;
      orderId?: string;
      reversesEntryId?: string;
    },
    idempotencyKey: string,
  ) {
    const scope = `courier-adjustment:${courierId}`;
    const fingerprint = requestFingerprint(input);
    const replay = await this.idempotencyReplay(
      scope,
      idempotencyKey,
      fingerprint,
    );
    if (replay) {
      return this.database.courierLedgerEntry.findUniqueOrThrow({
        where: { id: replay },
      });
    }
    const entryId = await this.database.$transaction(
      async (transaction) => {
        await this.claimIdempotency(
          transaction,
          scope,
          idempotencyKey,
          fingerprint,
        );
        await this.ensureCourier(transaction, courierId);
        let settlementId = input.settlementPeriodId;
        let originalAmountMinor: number | undefined;
        let originalSettlementPeriodId: string | undefined;
        if (input.type === 'REVERSAL') {
          const original = await transaction.courierLedgerEntry.findUnique({
            where: { id: input.reversesEntryId },
            include: {
              reversedBy: { select: { id: true } },
              settlementLine: true,
            },
          });
          if (
            !original ||
            original.courierId !== courierId ||
            original.reversedBy
          ) {
            throw new ConflictException(
              'The original ledger entry cannot be reversed.',
            );
          }
          originalAmountMinor = original.amountMinor;
          originalSettlementPeriodId =
            original.settlementLine?.settlementPeriodId;
          settlementId ??= originalSettlementPeriodId;
        }
        if (!settlementId) {
          settlementId = (
            await transaction.settlementPeriod.findFirst({
              where: { courierId },
              orderBy: [{ status: 'asc' }, { periodStart: 'desc' }],
              select: { id: true },
            })
          )?.id;
        }
        if (!settlementId) {
          throw new ConflictException(
            'A settlement period is required for this adjustment.',
          );
        }
        await transaction.$queryRaw`
          SELECT "id"
          FROM "SettlementPeriod"
          WHERE "id" = ${settlementId}::uuid
          FOR UPDATE
        `;
        const settlement = await transaction.settlementPeriod.findFirst({
          where: { id: settlementId, courierId },
        });
        if (!settlement) {
          throw new NotFoundException('Settlement period was not found.');
        }
        if (input.orderId) {
          const order = await transaction.deliveryOrder.findFirst({
            where: { id: input.orderId, courierId },
            select: { id: true },
          });
          if (!order) {
            throw new NotFoundException(
              'Courier order for adjustment was not found.',
            );
          }
        }
        const amountMinor =
          input.type === 'ADJUSTMENT_DEBIT'
            ? input.amountMinor
            : input.type === 'REVERSAL'
              ? -(originalAmountMinor ?? 0)
              : -input.amountMinor;
        const entry = await transaction.courierLedgerEntry.create({
          data: {
            courierId,
            orderId: input.orderId,
            type: input.type,
            amountMinor,
            currency: 'EGP',
            sourceKey: `adjustment:${courierId}:${idempotencyKey}`,
            reversesEntryId: input.reversesEntryId,
            createdById: actor.userId,
            reason: input.reason,
            metadata: {
              kind: 'admin_adjustment',
              settlementPeriodId: settlement.id,
            },
            occurredAt: new Date(),
          },
        });
        await transaction.settlementLine.create({
          data: {
            settlementPeriodId: settlement.id,
            ledgerEntryId: entry.id,
            amountMinor,
          },
        });
        await refreshSettlementProjection(transaction, settlement.id);
        await writeAudit(transaction, {
          actorId: actor.userId,
          actorRole: databaseRoleByRole[actor.role],
          action: `courier_account.${input.type.toLowerCase()}`,
          entityType: 'CourierLedgerEntry',
          entityId: entry.id,
          metadata: {
            courierId,
            settlementPeriodId: settlement.id,
            amountMinor,
          },
        });
        await this.completeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          entry.id,
        );
        return entry.id;
      },
      { isolationLevel: 'Serializable' },
    );
    return this.database.courierLedgerEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { settlementLine: true },
    });
  }

  public async settlementCsv(settlementId: string): Promise<string> {
    const settlement = await this.settlementDetail(settlementId);
    if (!settlement) {
      throw new NotFoundException('Settlement period was not found.');
    }
    const escape = (value: unknown) => {
      const stringValue =
        value instanceof Date ? value.toISOString() : String(value ?? '');
      return `"${stringValue.replaceAll('"', '""')}"`;
    };
    const rows: string[][] = [
      [
        'record_type',
        'record_id',
        'order_number',
        'entry_type',
        'amount_minor',
        'currency',
        'occurred_at',
        'source_key',
      ],
      ...settlement.lines.map((line) => [
        'ledger_entry',
        line.ledgerEntry.id,
        line.ledgerEntry.order?.orderNumber ?? '',
        line.ledgerEntry.type,
        String(line.ledgerEntry.amountMinor),
        line.ledgerEntry.currency,
        line.ledgerEntry.occurredAt.toISOString(),
        line.ledgerEntry.sourceKey,
      ]),
      ...settlement.paymentAllocations.map((allocation) => [
        'external_payment',
        allocation.payment.id,
        '',
        allocation.payment.reversesPaymentId ? 'REVERSAL' : 'PAYMENT',
        String(allocation.amountMinor),
        allocation.payment.currency,
        allocation.payment.paidAt.toISOString(),
        allocation.payment.idempotencyKey,
      ]),
    ];
    return `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}\r\n`;
  }

  private async zoneFinanceData() {
    const [zones, settlementLines, paymentAllocations] = await Promise.all([
      this.database.serviceZone.findMany({
        include: {
          courierMemberships: {
            where: {
              active: true,
              courier: {
                verificationStatus: 'APPROVED',
                user: { status: 'ACTIVE' },
              },
            },
            include: {
              courier: {
                select: {
                  id: true,
                  fullName: true,
                  preferredCity: true,
                  verificationStatus: true,
                  user: { select: { phone: true, status: true } },
                },
              },
            },
          },
        },
        orderBy: [{ governorate: 'asc' }, { city: 'asc' }, { name: 'asc' }],
      }),
      this.database.settlementLine.findMany({
        include: {
          ledgerEntry: {
            select: {
              courierId: true,
              amountMinor: true,
              type: true,
              occurredAt: true,
              order: {
                select: {
                  id: true,
                  serviceZoneId: true,
                  status: true,
                  merchantTotalMinor: true,
                  events: {
                    where: { eventType: 'ORDER_RETURNED' },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
          },
          settlementPeriod: {
            select: { id: true, status: true, dueAt: true },
          },
        },
      }),
      this.database.externalPaymentAllocation.findMany({
        where: {
          payment: {
            reversesPaymentId: null,
            reversedBy: null,
          },
        },
        include: {
          payment: {
            select: {
              id: true,
              courierId: true,
              paidAt: true,
            },
          },
        },
      }),
    ]);
    type FinanceZoneLine = ZoneSettlementLine & {
      orderId: string;
      orderStatus: string;
      orderReturned: boolean;
      grossOrderValueMinor: number;
      ledgerType: string;
    };
    const sourceLines: FinanceZoneLine[] = settlementLines.flatMap((line) =>
      line.ledgerEntry.order
        ? [
            {
              settlementPeriodId: line.settlementPeriodId,
              serviceZoneId: line.ledgerEntry.order.serviceZoneId,
              amountMinor: line.ledgerEntry.amountMinor,
              courierId: line.ledgerEntry.courierId,
              occurredAt: line.ledgerEntry.occurredAt,
              orderId: line.ledgerEntry.order.id,
              orderStatus: line.ledgerEntry.order.status,
              orderReturned: line.ledgerEntry.order.events.length > 0,
              grossOrderValueMinor: line.ledgerEntry.order.merchantTotalMinor,
              ledgerType: line.ledgerEntry.type,
            },
          ]
        : [],
    );
    const sourceAllocations: ZonePaymentAllocation[] = paymentAllocations.map(
      (allocation) => ({
        settlementPeriodId: allocation.settlementPeriodId,
        paymentId: allocation.payment.id,
        amountMinor: allocation.amountMinor,
        paidAt: allocation.payment.paidAt,
        courierId: allocation.payment.courierId,
      }),
    );
    const attributedPayments = attributePaymentsToZones(
      sourceLines,
      sourceAllocations,
    );
    type Metrics = {
      dueMinor: number;
      paidMinor: number;
      collectedTodayMinor: number;
      collectedMonthMinor: number;
      openSettlements: Set<string>;
      overdueSettlements: Set<string>;
      lastActivityAt: Date | null;
      completedOrderIds: Set<string>;
      returnedOrderIds: Set<string>;
      grossOrderValues: Map<string, number>;
      commissionDueMinor: number;
      lastPaymentAt: Date | null;
    };
    type CourierMetrics = Metrics & {
      latestDueAt: Date | null;
      latestSettlementStatus: string | null;
    };
    const metricsByZone = new Map<string, Metrics>();
    const metricsByZoneCourier = new Map<string, CourierMetrics>();
    const metricForZone = (zoneId: string): Metrics => {
      const existing = metricsByZone.get(zoneId);
      if (existing) return existing;
      const created: Metrics = {
        dueMinor: 0,
        paidMinor: 0,
        collectedTodayMinor: 0,
        collectedMonthMinor: 0,
        openSettlements: new Set(),
        overdueSettlements: new Set(),
        lastActivityAt: null,
        completedOrderIds: new Set(),
        returnedOrderIds: new Set(),
        grossOrderValues: new Map(),
        commissionDueMinor: 0,
        lastPaymentAt: null,
      };
      metricsByZone.set(zoneId, created);
      return created;
    };
    const metricForCourier = (
      zoneId: string,
      courierId: string,
    ): CourierMetrics => {
      const key = `${zoneId}:${courierId}`;
      const existing = metricsByZoneCourier.get(key);
      if (existing) return existing;
      const created: CourierMetrics = {
        dueMinor: 0,
        paidMinor: 0,
        collectedTodayMinor: 0,
        collectedMonthMinor: 0,
        openSettlements: new Set(),
        overdueSettlements: new Set(),
        lastActivityAt: null,
        completedOrderIds: new Set(),
        returnedOrderIds: new Set(),
        grossOrderValues: new Map(),
        commissionDueMinor: 0,
        lastPaymentAt: null,
        latestDueAt: null,
        latestSettlementStatus: null,
      };
      metricsByZoneCourier.set(key, created);
      return created;
    };
    const periodById = new Map(
      settlementLines.map((line) => [
        line.settlementPeriodId,
        line.settlementPeriod,
      ]),
    );
    for (const line of sourceLines) {
      const period = periodById.get(line.settlementPeriodId);
      const status = period?.status ?? 'OPEN';
      const dueAt = period?.dueAt ?? null;
      for (const metrics of [
        metricForZone(line.serviceZoneId),
        metricForCourier(line.serviceZoneId, line.courierId),
      ]) {
        metrics.dueMinor += line.amountMinor;
        if (status === 'OPEN')
          metrics.openSettlements.add(line.settlementPeriodId);
        if (status === 'OVERDUE') {
          metrics.overdueSettlements.add(line.settlementPeriodId);
        }
        if (
          !metrics.lastActivityAt ||
          line.occurredAt > metrics.lastActivityAt
        ) {
          metrics.lastActivityAt = line.occurredAt;
        }
        if (line.orderStatus === 'COMPLETED') {
          metrics.completedOrderIds.add(line.orderId);
        }
        if (line.orderReturned) metrics.returnedOrderIds.add(line.orderId);
        metrics.grossOrderValues.set(line.orderId, line.grossOrderValueMinor);
        if (line.ledgerType === 'COMMISSION_DUE') {
          metrics.commissionDueMinor += line.amountMinor;
        }
      }
      const courierMetrics = metricForCourier(
        line.serviceZoneId,
        line.courierId,
      );
      if (
        !courierMetrics.latestDueAt ||
        (dueAt && dueAt > courierMetrics.latestDueAt)
      ) {
        courierMetrics.latestDueAt = dueAt;
        courierMetrics.latestSettlementStatus = status;
      }
    }
    const { todayStart, tomorrowStart, monthStart } = cairoPeriodBounds();
    for (const payment of attributedPayments) {
      for (const metrics of [
        metricForZone(payment.serviceZoneId),
        metricForCourier(payment.serviceZoneId, payment.courierId),
      ]) {
        metrics.paidMinor += payment.attributedAmountMinor;
        if (payment.paidAt >= todayStart && payment.paidAt < tomorrowStart) {
          metrics.collectedTodayMinor += payment.attributedAmountMinor;
        }
        if (payment.paidAt >= monthStart && payment.paidAt < tomorrowStart) {
          metrics.collectedMonthMinor += payment.attributedAmountMinor;
        }
        if (
          !metrics.lastActivityAt ||
          payment.paidAt > metrics.lastActivityAt
        ) {
          metrics.lastActivityAt = payment.paidAt;
        }
        if (!metrics.lastPaymentAt || payment.paidAt > metrics.lastPaymentAt) {
          metrics.lastPaymentAt = payment.paidAt;
        }
      }
    }
    return { zones, metricsByZone, metricsByZoneCourier };
  }

  private async accountSummary(courierId: string, userId: string) {
    const [
      acceptedOrders,
      completedOrders,
      cancelledOrders,
      returnedOrders,
      completedFee,
      returnedFee,
      ledgerEntries,
      activePayments,
      currentSettlement,
      latestClosedSettlement,
    ] = await Promise.all([
      this.database.orderEvent.count({
        where: { eventType: 'COURIER_ACCEPTED', actorId: userId },
      }),
      this.database.deliveryOrder.count({
        where: { courierId, status: 'COMPLETED' },
      }),
      this.database.orderEvent.count({
        where: { eventType: 'COURIER_CANCELLED', actorId: userId },
      }),
      this.database.deliveryOrder.count({
        where: {
          courierId,
          events: { some: { eventType: 'ORDER_RETURNED' } },
        },
      }),
      this.database.deliveryOrder.aggregate({
        where: { courierId, status: 'COMPLETED' },
        _sum: { merchantTotalMinor: true },
      }),
      this.database.deliveryOrder.aggregate({
        where: {
          courierId,
          status: 'COMPLETED',
          events: { some: { eventType: 'ORDER_RETURNED' } },
        },
        _sum: { merchantTotalMinor: true },
      }),
      this.database.courierLedgerEntry.findMany({
        where: { courierId },
        select: { type: true, amountMinor: true, metadata: true },
      }),
      this.database.externalPaymentRecord.aggregate({
        where: {
          courierId,
          reversesPaymentId: null,
          reversedBy: null,
        },
        _sum: { amountMinor: true },
      }),
      this.database.settlementPeriod.findFirst({
        where: { courierId, status: 'OPEN' },
        orderBy: { periodStart: 'desc' },
      }),
      this.database.settlementPeriod.findFirst({
        where: { courierId, status: { not: 'OPEN' } },
        orderBy: { periodEnd: 'desc' },
      }),
    ]);
    const commissionDue = ledgerEntries
      .filter((entry) => entry.type === 'COMMISSION_DUE')
      .reduce((total, entry) => total + entry.amountMinor, 0);
    const adjustments = ledgerEntries
      .filter(
        (entry) =>
          entry.type === 'ADJUSTMENT_DEBIT' ||
          entry.type === 'ADJUSTMENT_CREDIT' ||
          (entry.type === 'REVERSAL' &&
            (entry.metadata as { kind?: string } | null)?.kind ===
              'admin_adjustment'),
      )
      .reduce((total, entry) => total + entry.amountMinor, 0);
    const waived = Math.abs(
      ledgerEntries
        .filter((entry) => entry.type === 'WAIVER')
        .reduce((total, entry) => total + entry.amountMinor, 0),
    );
    const remaining = Math.max(
      0,
      ledgerEntries.reduce((total, entry) => total + entry.amountMinor, 0),
    );
    const deadline =
      latestClosedSettlement?.dueAt ?? currentSettlement?.dueAt ?? null;
    return {
      acceptedOrders,
      completedOrders,
      cancelledOrders,
      returnedOrders,
      totalCompletedDeliveryFeesMinor:
        completedFee._sum.merchantTotalMinor ?? 0,
      totalReturnedOrderDeliveryFeesMinor:
        returnedFee._sum.merchantTotalMinor ?? 0,
      totalCommissionDueMinor: commissionDue,
      totalRecordedPaymentsMinor: activePayments._sum.amountMinor ?? 0,
      totalAdjustmentsMinor: adjustments,
      totalWaivedMinor: waived,
      remainingAmountMinor: remaining,
      currentSettlement: currentSettlement
        ? this.withDeadline(currentSettlement)
        : null,
      latestClosedSettlement: latestClosedSettlement
        ? this.withDeadline(latestClosedSettlement)
        : null,
      paymentDeadline: deadline,
      daysRemaining: deadline ? daysRemaining(deadline) : null,
      currentPaymentStatus:
        latestClosedSettlement?.status ?? currentSettlement?.status ?? 'OPEN',
      currency: 'EGP',
    };
  }

  private settlementDetail(settlementId: string, courierId?: string) {
    return this.database.settlementPeriod.findFirst({
      where: {
        id: settlementId,
        ...(courierId ? { courierId } : {}),
      },
      include: {
        courier: {
          select: {
            id: true,
            fullName: true,
            preferredCity: true,
            user: { select: { phone: true, status: true } },
          },
        },
        lines: {
          include: {
            ledgerEntry: {
              include: {
                order: {
                  select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    merchantTotalMinor: true,
                    platformCommissionMinor: true,
                    platformCommissionBasisPoints: true,
                    createdAt: true,
                  },
                },
                createdBy: {
                  select: { id: true, displayName: true, role: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        paymentAllocations: {
          include: {
            payment: {
              include: {
                createdBy: {
                  select: { id: true, displayName: true, role: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  private externalPayment(paymentId: string) {
    return this.database.externalPaymentRecord.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        courier: { select: { id: true, fullName: true } },
        createdBy: {
          select: { id: true, displayName: true, role: true },
        },
        allocations: {
          include: {
            settlementPeriod: {
              select: {
                id: true,
                periodStart: true,
                periodEnd: true,
                remainingAmountMinor: true,
                status: true,
              },
            },
          },
        },
        reversesPayment: { select: { id: true } },
        reversedBy: { select: { id: true } },
      },
    });
  }

  private withDeadline<T extends { dueAt: Date }>(settlement: T) {
    return { ...settlement, daysRemaining: daysRemaining(settlement.dueAt) };
  }

  private async courierForUser(userId: string) {
    const courier = await this.database.courierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!courier) throw new NotFoundException('Courier profile was not found.');
    return courier;
  }

  private async ensureCourier(transaction: Transaction, courierId: string) {
    const courier = await transaction.courierProfile.findUnique({
      where: { id: courierId },
      select: { id: true },
    });
    if (!courier) throw new NotFoundException('Courier was not found.');
    return courier;
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
    if (record.status === 'COMPLETED' && body?.entityId) {
      return body.entityId;
    }
    throw new ConflictException('The request is already processing.');
  }
}
