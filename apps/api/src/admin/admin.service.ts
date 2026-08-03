import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CourierVerificationStatus,
  DocumentStatus,
  MerchantStatus,
  PrismaClient,
  UserStatus,
} from '@wasel/database';

import { requiredCourierDocumentTypes } from '../courier/courier-policy.js';
import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';

type Actor = {
  userId: string;
  role: 'operations_admin' | 'super_admin';
};

@Injectable()
export class AdminService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
  ) {}

  public async couriers(input: {
    status?: CourierVerificationStatus;
    search?: string;
    city?: string;
    serviceZoneId?: string;
    submittedFrom?: Date;
    submittedTo?: Date;
    documentExpiryBefore?: Date;
  }) {
    const couriers = await this.database.courierProfile.findMany({
      where: {
        ...(input.status ? { verificationStatus: input.status } : {}),
        ...(input.city ? { preferredCity: input.city } : {}),
        ...(input.serviceZoneId
          ? {
              serviceZones: {
                some: { serviceZoneId: input.serviceZoneId, active: true },
              },
            }
          : {}),
        ...(input.submittedFrom || input.submittedTo
          ? {
              submittedAt: {
                ...(input.submittedFrom ? { gte: input.submittedFrom } : {}),
                ...(input.submittedTo ? { lte: input.submittedTo } : {}),
              },
            }
          : {}),
        ...(input.documentExpiryBefore
          ? {
              documents: {
                some: {
                  isCurrent: true,
                  expiresAt: { lte: input.documentExpiryBefore },
                },
              },
            }
          : {}),
        ...(input.search
          ? {
              OR: [
                {
                  fullName: {
                    contains: input.search,
                    mode: 'insensitive' as const,
                  },
                },
                { user: { phone: { contains: input.search } } },
              ],
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            displayName: true,
            status: true,
          },
        },
        serviceZones: {
          where: { active: true },
          include: {
            serviceZone: {
              select: {
                id: true,
                name: true,
                city: true,
                governorate: true,
              },
            },
          },
        },
        documents: {
          where: { isCurrent: true },
          select: {
            type: true,
            status: true,
            expiresAt: true,
            reviewedAt: true,
            reviewedBy: {
              select: { id: true, displayName: true, role: true },
            },
          },
        },
        verificationEvents: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            actor: { select: { id: true, displayName: true, role: true } },
          },
        },
        _count: { select: { documents: true, vehicles: true } },
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
    });
    return couriers.map((courier) => {
      const currentTypes = new Set(courier.documents.map((item) => item.type));
      return {
        ...courier,
        verificationEvents: courier.verificationEvents.map(
          ({ id, ...event }) => ({ id: id.toString(), ...event }),
        ),
        missingDocumentTypes: requiredCourierDocumentTypes.filter(
          (type) => !currentTypes.has(type),
        ),
        rejectedDocumentCount: courier.documents.filter((document) =>
          ['REJECTED', 'CHANGES_REQUESTED', 'EXPIRED'].includes(
            document.status,
          ),
        ).length,
        reviewDate:
          courier.verificationEvents[0]?.createdAt ??
          courier.documents
            .map((document) => document.reviewedAt)
            .filter((value): value is Date => Boolean(value))
            .sort((left, right) => right.getTime() - left.getTime())[0] ??
          null,
        reviewer:
          courier.verificationEvents[0]?.actor ??
          courier.documents.find((document) => document.reviewedBy)
            ?.reviewedBy ??
          null,
      };
    });
  }

  public async courierVerificationSummary() {
    const grouped = await this.database.courierProfile.groupBy({
      by: ['verificationStatus'],
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      grouped.map((row) => [row.verificationStatus, row._count._all]),
    );
    return {
      pendingReview: counts.PENDING_REVIEW ?? 0,
      approved: counts.APPROVED ?? 0,
      changesRequested: counts.CHANGES_REQUESTED ?? 0,
      suspended: counts.SUSPENDED ?? 0,
    };
  }

  public async courier(courierId: string) {
    const courier = await this.database.courierProfile.findUnique({
      where: { id: courierId },
      include: {
        user: true,
        vehicles: { orderBy: { createdAt: 'asc' } },
        serviceZones: {
          include: {
            serviceZone: {
              select: {
                id: true,
                name: true,
                city: true,
                governorate: true,
                status: true,
              },
            },
          },
        },
        documents: {
          orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
          omit: { storageKey: true },
        },
        verificationEvents: {
          take: 100,
          include: {
            actor: { select: { id: true, displayName: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!courier) throw new NotFoundException('Courier was not found.');
    return {
      ...courier,
      verificationEvents: courier.verificationEvents.map(
        ({ id, ...event }) => ({ id: id.toString(), ...event }),
      ),
    };
  }

  public async documents(courierId: string) {
    await this.requireCourier(courierId);
    return this.database.courierDocument.findMany({
      where: { courierId },
      orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
      omit: { storageKey: true },
    });
  }

  public async reviewDocument(
    actor: Actor,
    courierId: string,
    documentId: string,
    input: {
      action: 'approve' | 'reject' | 'request_replacement';
      reason?: string;
      version: number;
    },
  ) {
    if (input.action !== 'approve' && !input.reason?.trim()) {
      throw new BadRequestException('A review reason is required.');
    }
    const statusByAction: Record<typeof input.action, DocumentStatus> = {
      approve: 'APPROVED',
      reject: 'REJECTED',
      request_replacement: 'CHANGES_REQUESTED',
    };
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.courierDocument.findFirst({
        where: { id: documentId, courierId, isCurrent: true },
      });
      if (!current) throw new NotFoundException('Document was not found.');
      const result = await transaction.courierDocument.updateMany({
        where: {
          id: documentId,
          courierId,
          isCurrent: true,
          reviewVersion: input.version,
          status: { in: ['PENDING', 'REJECTED', 'CHANGES_REQUESTED'] },
        },
        data: {
          status: statusByAction[input.action],
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          reviewNotes: input.reason?.trim() ?? null,
          reviewVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'Document review changed. Reload before acting.',
        );
      }
      if (input.action === 'request_replacement') {
        await transaction.courierProfile.updateMany({
          where: {
            id: courierId,
            verificationStatus: { in: ['PENDING_REVIEW', 'CHANGES_REQUESTED'] },
          },
          data: {
            verificationStatus: 'CHANGES_REQUESTED',
            statusReason: input.reason,
            version: { increment: 1 },
          },
        });
      }
      await transaction.courierVerificationEvent.create({
        data: {
          courierId,
          actorId: actor.userId,
          action: `document.${input.action}`,
          reason: input.reason,
          metadata: { documentId, documentType: current.type },
        },
      });
      await writeAudit(transaction, {
        actorId: actor.userId,
        actorRole:
          actor.role === 'super_admin' ? 'SUPER_ADMIN' : 'OPERATIONS_ADMIN',
        action: `courier_document.${input.action}`,
        entityType: 'CourierDocument',
        entityId: documentId,
        metadata: { courierId },
      });
      return transaction.courierDocument.findUniqueOrThrow({
        where: { id: documentId },
        omit: { storageKey: true },
      });
    });
  }

  public async transitionCourier(
    actor: Actor,
    courierId: string,
    input: {
      action:
        'approve' | 'request_changes' | 'reject' | 'suspend' | 'reactivate';
      reason?: string;
      version: number;
    },
  ) {
    if (
      ['request_changes', 'reject', 'suspend'].includes(input.action) &&
      !input.reason?.trim()
    ) {
      throw new BadRequestException('A reason is required.');
    }
    return this.database.$transaction(async (transaction) => {
      const courier = await transaction.courierProfile.findUnique({
        where: { id: courierId },
      });
      if (!courier) throw new NotFoundException('Courier was not found.');
      // Prisma relation includes may fan out concurrently. An interactive
      // transaction owns one pg client, so keep these reads explicitly
      // sequential to avoid overlapping client.query() calls.
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: courier.userId },
        select: { status: true },
      });
      const vehicles = await transaction.vehicle.findMany({
        where: { courierId, active: true, type: 'MOTORCYCLE' },
        select: { id: true },
      });
      const documents = await transaction.courierDocument.findMany({
        where: { courierId, isCurrent: true },
        select: { type: true, status: true, expiresAt: true },
      });

      const rules: Record<
        typeof input.action,
        {
          from: CourierVerificationStatus[];
          to: CourierVerificationStatus;
        }
      > = {
        approve: { from: ['PENDING_REVIEW'], to: 'APPROVED' },
        request_changes: {
          from: ['PENDING_REVIEW'],
          to: 'CHANGES_REQUESTED',
        },
        reject: {
          from: ['PENDING_REVIEW', 'CHANGES_REQUESTED'],
          to: 'REJECTED',
        },
        suspend: { from: ['APPROVED'], to: 'SUSPENDED' },
        reactivate: { from: ['SUSPENDED'], to: 'APPROVED' },
      };
      const rule = rules[input.action];
      if (!rule.from.includes(courier.verificationStatus)) {
        throw new ConflictException(
          `Cannot ${input.action} from ${courier.verificationStatus}.`,
        );
      }
      if (input.action === 'approve' || input.action === 'reactivate') {
        this.assertValidForApproval({ user, vehicles, documents });
      }

      const result = await transaction.courierProfile.updateMany({
        where: {
          id: courierId,
          version: input.version,
          verificationStatus: { in: rule.from },
        },
        data: {
          verificationStatus: rule.to,
          statusReason: input.reason?.trim() ?? null,
          ...(input.action === 'approve' || input.action === 'reactivate'
            ? {
                approvedAt: new Date(),
                rejectedAt: null,
                suspendedAt: null,
              }
            : {}),
          ...(input.action === 'reject' ? { rejectedAt: new Date() } : {}),
          ...(input.action === 'suspend' ? { suspendedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'Courier review changed. Reload before acting.',
        );
      }
      if (input.action === 'approve' || input.action === 'reactivate') {
        await transaction.user.update({
          where: { id: courier.userId },
          data: { status: 'ACTIVE' },
        });
        const zones = await transaction.serviceZone.findMany({
          where: {
            status: 'ACTIVE',
            ...(courier.preferredCity
              ? { city: courier.preferredCity }
              : { id: { in: [] } }),
          },
          select: { id: true },
        });
        if (zones.length > 0) {
          await transaction.courierServiceZone.updateMany({
            where: {
              courierId,
              serviceZoneId: { in: zones.map((zone) => zone.id) },
            },
            data: { active: true, version: { increment: 1 } },
          });
          await transaction.courierServiceZone.createMany({
            data: zones.map((zone) => ({
              courierId,
              serviceZoneId: zone.id,
              createdById: actor.userId,
            })),
            skipDuplicates: true,
          });
        }
      }
      await transaction.courierVerificationEvent.create({
        data: {
          courierId,
          actorId: actor.userId,
          action: input.action,
          fromStatus: courier.verificationStatus,
          toStatus: rule.to,
          reason: input.reason?.trim(),
        },
      });
      await writeAudit(transaction, {
        actorId: actor.userId,
        actorRole:
          actor.role === 'super_admin' ? 'SUPER_ADMIN' : 'OPERATIONS_ADMIN',
        action: `courier.${input.action}`,
        entityType: 'CourierProfile',
        entityId: courierId,
        metadata: {
          fromStatus: courier.verificationStatus,
          toStatus: rule.to,
        },
      });
      return transaction.courierProfile.findUniqueOrThrow({
        where: { id: courierId },
      });
    });
  }

  public async verificationHistory(courierId: string) {
    await this.requireCourier(courierId);
    const events = await this.database.courierVerificationEvent.findMany({
      where: { courierId },
      include: {
        actor: {
          select: { id: true, displayName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return events.map(({ id, ...event }) => ({ id: id.toString(), ...event }));
  }

  public async auditLog(courierId: string) {
    await this.requireCourier(courierId);
    const documents = await this.database.courierDocument.findMany({
      where: { courierId },
      select: { id: true },
    });
    const ids = [courierId, ...documents.map(({ id }) => id)];
    const logs = await this.database.auditLog.findMany({
      where: {
        OR: [
          { entityId: { in: ids } },
          { metadata: { path: ['courierId'], equals: courierId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return logs.map(({ id, ...log }) => ({ id: id.toString(), ...log }));
  }

  public merchants() {
    return this.database.merchant.findMany({
      include: {
        _count: { select: { stores: true, memberships: true } },
        stores: {
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
        memberships: {
          where: { active: true, role: 'OWNER' },
          take: 1,
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                phone: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async merchant(merchantId: string) {
    const [merchant, stores] = await Promise.all([
      this.database.merchant.findUnique({
        where: { id: merchantId },
        include: {
          _count: { select: { stores: true, memberships: true } },
          memberships: { include: { user: true } },
        },
      }),
      this.database.$queryRaw<Array<Record<string, unknown>>>`
        SELECT
          "id", "merchantId", "name", "phone", "addressLine", "governorate",
          "city", "area", "street", "addressDetails", "status", "version",
          "createdAt", "updatedAt",
          ST_Y("location"::geometry) AS "latitude",
          ST_X("location"::geometry) AS "longitude"
        FROM "Store"
        WHERE "merchantId" = ${merchantId}::uuid
        ORDER BY "createdAt" ASC
      `,
    ]);
    if (!merchant) throw new NotFoundException('Merchant was not found.');
    return { ...merchant, stores };
  }

  public async transitionMerchant(
    actor: Actor,
    merchantId: string,
    input: {
      action:
        'approve' | 'reject' | 'request_changes' | 'suspend' | 'reactivate';
      version: number;
      reason?: string;
    },
  ) {
    if (
      ['reject', 'request_changes', 'suspend'].includes(input.action) &&
      !input.reason?.trim()
    ) {
      throw new BadRequestException('A reason is required.');
    }
    const rules: Record<
      typeof input.action,
      { from: MerchantStatus[]; to: MerchantStatus }
    > = {
      approve: { from: ['PENDING', 'CHANGES_REQUESTED'], to: 'ACTIVE' },
      reject: { from: ['PENDING', 'CHANGES_REQUESTED'], to: 'BLOCKED' },
      request_changes: { from: ['PENDING'], to: 'CHANGES_REQUESTED' },
      suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
      reactivate: { from: ['SUSPENDED'], to: 'ACTIVE' },
    };
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.merchant.findUnique({
        where: { id: merchantId },
        include: {
          memberships: {
            where: { active: true, role: 'OWNER' },
            select: { userId: true },
          },
        },
      });
      if (!current) throw new NotFoundException('Merchant was not found.');
      const rule = rules[input.action];
      if (!rule.from.includes(current.status)) {
        throw new ConflictException(
          `Cannot ${input.action} merchant from ${current.status}.`,
        );
      }
      if (current.memberships.length === 0) {
        throw new BadRequestException('An active merchant owner is required.');
      }
      const updated = await transaction.merchant.updateMany({
        where: {
          id: merchantId,
          version: input.version,
          status: { in: rule.from },
        },
        data: {
          status: rule.to,
          reviewNotes:
            input.action === 'approve' || input.action === 'reactivate'
              ? null
              : (input.reason?.trim() ?? null),
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Merchant review changed. Reload before acting.',
        );
      }
      await transaction.user.updateMany({
        where: { id: { in: current.memberships.map(({ userId }) => userId) } },
        data: {
          status:
            rule.to === 'ACTIVE'
              ? 'ACTIVE'
              : rule.to === 'CHANGES_REQUESTED'
                ? 'PENDING'
                : rule.to,
        },
      });
      if (rule.to === 'BLOCKED' || rule.to === 'SUSPENDED') {
        await transaction.session.updateMany({
          where: {
            userId: {
              in: current.memberships.map(({ userId }) => userId),
            },
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revokedReason: `merchant_${rule.to.toLowerCase()}`,
            version: { increment: 1 },
          },
        });
      }
      await writeAudit(transaction, {
        actorId: actor.userId,
        actorRole:
          actor.role === 'super_admin' ? 'SUPER_ADMIN' : 'OPERATIONS_ADMIN',
        action: `merchant.${input.action}`,
        entityType: 'Merchant',
        entityId: merchantId,
        before: { status: current.status },
        after: { status: rule.to },
        metadata: { reason: input.reason?.trim() ?? null },
      });
      return transaction.merchant.findUniqueOrThrow({
        where: { id: merchantId },
      });
    });
  }

  public async updateUserStatus(
    actor: Actor,
    userId: string,
    input: { status: UserStatus },
  ) {
    const before = await this.database.user.findUnique({
      where: { id: userId },
    });
    if (!before) throw new NotFoundException('User was not found.');
    if (actor.userId === userId && input.status !== 'ACTIVE') {
      throw new ConflictException('Administrators cannot disable themselves.');
    }
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: userId },
        data: { status: input.status },
      });
      if (input.status !== 'ACTIVE') {
        await transaction.session.updateMany({
          where: { userId, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revokedReason: `user_${input.status.toLowerCase()}`,
            version: { increment: 1 },
          },
        });
      }
      await writeAudit(transaction, {
        actorId: actor.userId,
        actorRole:
          actor.role === 'super_admin' ? 'SUPER_ADMIN' : 'OPERATIONS_ADMIN',
        action: 'user.status_changed',
        entityType: 'User',
        entityId: userId,
        before: { status: before.status },
        after: { status: user.status },
      });
      return user;
    });
  }

  private async requireCourier(courierId: string): Promise<void> {
    const found = await this.database.courierProfile.findUnique({
      where: { id: courierId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Courier was not found.');
  }

  private assertValidForApproval(courier: {
    user: { status: UserStatus };
    vehicles: readonly unknown[];
    documents: readonly {
      type: string;
      status: DocumentStatus;
      expiresAt: Date | null;
    }[];
  }): void {
    const today = new Date();
    const invalid = requiredCourierDocumentTypes.filter((type) => {
      const document = courier.documents.find(
        (candidate) => candidate.type === type,
      );
      return (
        !document ||
        document.status !== 'APPROVED' ||
        (document.expiresAt !== null && document.expiresAt < today)
      );
    });
    if (
      !['ACTIVE', 'PENDING'].includes(courier.user.status) ||
      courier.vehicles.length === 0 ||
      invalid.length > 0
    ) {
      throw new BadRequestException({
        message: 'Courier is not eligible for approval.',
        invalidDocuments: invalid,
        activeMotorcycleRequired: courier.vehicles.length === 0,
        accountStatus: courier.user.status,
      });
    }
  }
}
