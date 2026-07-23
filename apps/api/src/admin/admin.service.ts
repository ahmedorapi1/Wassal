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
  }) {
    return this.database.courierProfile.findMany({
      where: {
        ...(input.status ? { verificationStatus: input.status } : {}),
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
        _count: { select: { documents: true, vehicles: true } },
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  public async courier(courierId: string) {
    const courier = await this.database.courierProfile.findUnique({
      where: { id: courierId },
      include: {
        user: true,
        vehicles: { orderBy: { createdAt: 'asc' } },
        documents: {
          orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }],
          omit: { storageKey: true },
        },
      },
    });
    if (!courier) throw new NotFoundException('Courier was not found.');
    return courier;
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
      action: 'approve' | 'reject' | 'suspend' | 'reactivate';
      reason?: string;
      version: number;
    },
  ) {
    if (['reject', 'suspend'].includes(input.action) && !input.reason?.trim()) {
      throw new BadRequestException('A reason is required.');
    }
    return this.database.$transaction(async (transaction) => {
      const courier = await transaction.courierProfile.findUnique({
        where: { id: courierId },
        include: {
          user: true,
          vehicles: { where: { active: true, type: 'MOTORCYCLE' } },
          documents: { where: { isCurrent: true } },
        },
      });
      if (!courier) throw new NotFoundException('Courier was not found.');

      const rules: Record<
        typeof input.action,
        {
          from: CourierVerificationStatus[];
          to: CourierVerificationStatus;
        }
      > = {
        approve: { from: ['PENDING_REVIEW'], to: 'APPROVED' },
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
        this.assertValidForApproval(courier);
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
      include: { _count: { select: { stores: true, memberships: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async merchant(merchantId: string) {
    const merchant = await this.database.merchant.findUnique({
      where: { id: merchantId },
      include: {
        stores: true,
        memberships: { include: { user: true } },
      },
    });
    if (!merchant) throw new NotFoundException('Merchant was not found.');
    return merchant;
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
      courier.user.status !== 'ACTIVE' ||
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
