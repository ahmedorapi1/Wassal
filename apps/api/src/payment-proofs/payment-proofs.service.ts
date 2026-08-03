import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ExternalPaymentMethod,
  PaymentProofStatus,
  Prisma,
  PrismaClient,
} from '@wasel/database';
import type { ObjectStorageProvider } from '@wasel/providers';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { FinanceService } from '../finance/finance.service.js';
import { DATABASE, OBJECT_STORAGE } from '../infrastructure/tokens.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  paymentProofApproval,
  proofDuplicateIndicators,
} from '../operations/phase-four-domain.js';

type Actor = {
  userId: string;
  role: 'finance_admin' | 'super_admin';
};

@Injectable()
export class PaymentProofsService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageProvider,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  public async submit(
    userId: string,
    input: {
      amountMinor: number;
      method: ExternalPaymentMethod;
      paidAt: Date;
      externalReference?: string;
      note?: string;
    },
    file: Express.Multer.File | undefined,
    idempotencyKey: string,
  ) {
    const courier = await this.courierForUser(userId);
    const existing = await this.database.courierPaymentProof.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.courierId !== courier.id) {
        throw new ConflictException('The idempotency key is already in use.');
      }
      return this.publicProof(existing);
    }
    const safeFile = this.validateFile(file);
    const proofId = randomUUID();
    const objectKey = `payment-proofs/${courier.id}/${proofId}`;
    const checksumSha256 = createHash('sha256')
      .update(safeFile.buffer)
      .digest('hex');
    const normalizedReference = this.normalizeReference(
      input.externalReference,
    );
    const dayStart = new Date(input.paidAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000);
    const duplicateCandidates =
      await this.database.courierPaymentProof.findMany({
        where: {
          OR: [
            { checksumSha256 },
            ...(normalizedReference ? [{ normalizedReference }] : []),
            {
              courierId: courier.id,
              submittedAmountMinor: input.amountMinor,
              paidAt: { gte: dayStart, lt: dayEnd },
            },
          ],
        },
        select: {
          id: true,
          checksumSha256: true,
          normalizedReference: true,
          submittedAmountMinor: true,
          paidAt: true,
        },
        take: 10,
      });
    const duplicateSummary = proofDuplicateIndicators({
      checksumMatches: duplicateCandidates.some(
        (candidate) => candidate.checksumSha256 === checksumSha256,
      ),
      referenceMatches:
        normalizedReference !== undefined &&
        duplicateCandidates.some(
          (candidate) => candidate.normalizedReference === normalizedReference,
        ),
      sameCourierAmountDate: duplicateCandidates.some(
        (candidate) =>
          candidate.submittedAmountMinor === input.amountMinor &&
          candidate.paidAt >= dayStart &&
          candidate.paidAt < dayEnd,
      ),
    });
    const duplicateIndicators: Prisma.InputJsonValue = {
      ...duplicateSummary,
      candidateIds: duplicateCandidates.map((candidate) => candidate.id),
    };
    await this.storage.putObject({
      objectKey,
      contentType: safeFile.mimetype,
      bytes: safeFile.buffer,
    });
    try {
      const proof = await this.database.$transaction(async (transaction) => {
        const created = await transaction.courierPaymentProof.create({
          data: {
            id: proofId,
            courierId: courier.id,
            submittedAmountMinor: input.amountMinor,
            method: input.method,
            paidAt: input.paidAt,
            externalReference: input.externalReference,
            normalizedReference,
            note: input.note,
            storageKey: objectKey,
            originalFilename: this.safeFilename(safeFile.originalname),
            contentType: safeFile.mimetype,
            sizeBytes: safeFile.size,
            checksumSha256,
            duplicateIndicators,
            idempotencyKey,
          },
        });
        await this.notifyFinance(transaction, created.id, courier.fullName);
        return created;
      });
      return this.publicProof(proof);
    } catch (error) {
      await this.storage.deleteObject(objectKey);
      throw error;
    }
  }

  public async courierList(userId: string) {
    const courier = await this.courierForUser(userId);
    const proofs = await this.database.courierPaymentProof.findMany({
      where: { courierId: courier.id },
      include: {
        linkedExternalPayment: {
          select: { id: true, amountMinor: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return proofs.map((proof) => this.publicProof(proof));
  }

  public async courierDetail(userId: string, proofId: string) {
    const courier = await this.courierForUser(userId);
    const proof = await this.database.courierPaymentProof.findFirst({
      where: { id: proofId, courierId: courier.id },
      include: {
        linkedExternalPayment: true,
        reviews: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!proof) throw new NotFoundException('Payment proof was not found.');
    return this.publicProof(proof);
  }

  public async cancel(userId: string, proofId: string, version: number) {
    const courier = await this.courierForUser(userId);
    const proof = await this.database.courierPaymentProof.findFirst({
      where: { id: proofId, courierId: courier.id },
    });
    if (!proof) throw new NotFoundException('Payment proof was not found.');
    const result = await this.database.courierPaymentProof.updateMany({
      where: {
        id: proof.id,
        courierId: courier.id,
        status: 'PENDING_CONFIRMATION',
        version,
      },
      data: {
        status: 'CANCELLED_BY_COURIER',
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'Only a current pending proof may be cancelled.',
      );
    }
    return this.courierDetail(userId, proofId);
  }

  public adminList(input: { status?: PaymentProofStatus; courierId?: string }) {
    return this.database.courierPaymentProof.findMany({
      where: input,
      include: {
        courier: {
          select: {
            id: true,
            fullName: true,
            user: { select: { phone: true } },
          },
        },
        linkedExternalPayment: { select: { id: true, amountMinor: true } },
      },
      omit: { storageKey: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async adminDetail(proofId: string) {
    const proof = await this.database.courierPaymentProof.findUnique({
      where: { id: proofId },
      include: {
        courier: { include: { settlementPeriods: true } },
        linkedExternalPayment: true,
        reviews: {
          include: {
            actor: { select: { id: true, displayName: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      omit: { storageKey: true },
    });
    if (!proof) throw new NotFoundException('Payment proof was not found.');
    return proof;
  }

  public async approve(
    actor: Actor,
    proofId: string,
    input: { version: number; approvedAmountMinor: number; reason?: string },
    idempotencyKey: string,
  ) {
    const proof = await this.database.courierPaymentProof.findUnique({
      where: { id: proofId },
      include: { linkedExternalPayment: true },
    });
    if (!proof) throw new NotFoundException('Payment proof was not found.');
    if (proof.linkedExternalPayment) return this.adminDetail(proofId);
    if (
      proof.status !== 'PENDING_CONFIRMATION' ||
      proof.version !== input.version ||
      input.approvedAmountMinor > proof.submittedAmountMinor
    ) {
      throw new ConflictException(
        'The pending proof or approved amount is invalid.',
      );
    }
    if (
      input.approvedAmountMinor !== proof.submittedAmountMinor &&
      !input.reason?.trim()
    ) {
      throw new BadRequestException(
        'A reason is required when approving a different amount.',
      );
    }
    await this.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
        SELECT "id"
        FROM "CourierPaymentProof"
        WHERE "id" = ${proofId}::uuid
        FOR UPDATE
      `;
        const current = await transaction.courierPaymentProof.findUnique({
          where: { id: proofId },
        });
        if (
          !current ||
          current.status !== 'PENDING_CONFIRMATION' ||
          current.version !== input.version ||
          current.linkedExternalPaymentId !== null
        ) {
          throw new ConflictException(
            'The payment proof was reviewed concurrently.',
          );
        }
        const payment = await this.finance.recordExternalPaymentInTransaction(
          transaction,
          actor,
          current.courierId,
          {
            amountMinor: input.approvedAmountMinor,
            currency: 'EGP',
            paidAt: current.paidAt.toISOString(),
            method: current.method,
            externalReference: current.externalReference ?? undefined,
            note: `Approved from payment proof ${current.id}. ${input.reason ?? ''}`.trim(),
          },
          idempotencyKey,
        );
        const status: PaymentProofStatus = paymentProofApproval({
          submittedAmountMinor: current.submittedAmountMinor,
          approvedAmountMinor: input.approvedAmountMinor,
          reason: input.reason,
        });
        const result = await transaction.courierPaymentProof.updateMany({
          where: {
            id: current.id,
            status: 'PENDING_CONFIRMATION',
            version: input.version,
            linkedExternalPaymentId: null,
          },
          data: {
            status,
            approvedAmountMinor: input.approvedAmountMinor,
            reviewReason: input.reason,
            reviewedById: actor.userId,
            reviewedAt: new Date(),
            linkedExternalPaymentId: payment.id,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'The payment proof was reviewed concurrently.',
          );
        }
        await transaction.paymentProofReview.create({
          data: {
            paymentProofId: current.id,
            actorId: actor.userId,
            fromStatus: 'PENDING_CONFIRMATION',
            toStatus: status,
            approvedAmountMinor: input.approvedAmountMinor,
            reason: input.reason,
            metadata: { externalPaymentId: payment.id },
          },
        });
        await this.notifyCourier(
          transaction,
          current.courierId,
          current.id,
          status,
        );
      },
      { isolationLevel: 'Serializable' },
    );
    return this.adminDetail(proofId);
  }

  public async reject(
    actor: Actor,
    proofId: string,
    input: { version: number; reason: string },
  ) {
    return this.database.$transaction(async (transaction) => {
      const proof = await transaction.courierPaymentProof.findUnique({
        where: { id: proofId },
      });
      if (!proof) throw new NotFoundException('Payment proof was not found.');
      const result = await transaction.courierPaymentProof.updateMany({
        where: {
          id: proof.id,
          status: 'PENDING_CONFIRMATION',
          version: input.version,
        },
        data: {
          status: 'REJECTED',
          reviewReason: input.reason,
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('The payment proof is no longer pending.');
      }
      await transaction.paymentProofReview.create({
        data: {
          paymentProofId: proof.id,
          actorId: actor.userId,
          fromStatus: 'PENDING_CONFIRMATION',
          toStatus: 'REJECTED',
          reason: input.reason,
        },
      });
      await this.notifyCourier(
        transaction,
        proof.courierId,
        proof.id,
        'REJECTED',
      );
      return transaction.courierPaymentProof.findUniqueOrThrow({
        where: { id: proof.id },
        omit: { storageKey: true },
      });
    });
  }

  public async file(actor: { userId: string; role: string }, proofId: string) {
    const proof = await this.database.courierPaymentProof.findUnique({
      where: { id: proofId },
      include: { courier: { select: { userId: true } } },
    });
    if (!proof) throw new NotFoundException('Payment proof was not found.');
    const financeAccess = ['finance_admin', 'super_admin'].includes(actor.role);
    if (!financeAccess && proof.courier.userId !== actor.userId) {
      throw new ForbiddenException('Payment proof file access is denied.');
    }
    const stored = await this.storage.getObject(proof.storageKey);
    return {
      ...stored,
      contentType: proof.contentType,
      filename: proof.originalFilename,
    };
  }

  private async courierForUser(userId: string) {
    const courier = await this.database.courierProfile.findUnique({
      where: { userId },
      select: { id: true, fullName: true },
    });
    if (!courier) throw new NotFoundException('Courier profile was not found.');
    return courier;
  }

  private validateFile(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('A receipt screenshot is required.');
    }
    if (file.size > 5_242_880) {
      throw new BadRequestException('The receipt image exceeds 5 MB.');
    }
    const png =
      file.buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const jpeg = file.buffer.subarray(0, 3).toString('hex') === 'ffd8ff';
    if (
      (!png && !jpeg) ||
      !['image/png', 'image/jpeg'].includes(file.mimetype.toLowerCase())
    ) {
      throw new BadRequestException(
        'Only a valid JPG or PNG receipt is accepted.',
      );
    }
    return file;
  }

  private safeFilename(value: string) {
    return basename(value)
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}._ -]/gu, '_')
      .slice(0, 255);
  }

  private normalizeReference(value: string | undefined) {
    const normalized = value
      ?.trim()
      .replace(/[\s_-]+/g, '')
      .toUpperCase();
    return normalized || undefined;
  }

  private publicProof<T extends { storageKey: string }>(
    proof: T,
  ): Omit<T, 'storageKey'> {
    const { storageKey: _privateStorageKey, ...publicProof } = proof;
    return publicProof;
  }

  private async notifyFinance(
    transaction: Prisma.TransactionClient,
    proofId: string,
    courierName: string,
  ) {
    const admins = await transaction.user.findMany({
      where: {
        role: { in: ['FINANCE_ADMIN', 'SUPER_ADMIN'] },
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notifications.create(transaction, {
        recipientUserId: admin.id,
        type: 'PAYMENT_PROOF_PENDING',
        title: 'إثبات دفع جديد',
        body: `أرسل ${courierName} إثبات دفع للمراجعة.`,
        relatedEntityType: 'CourierPaymentProof',
        relatedEntityId: proofId,
        deepLink: `/payment-proofs/${proofId}`,
        deduplicationKey: `payment-proof:${proofId}:pending:${admin.id}`,
      });
    }
  }

  private async notifyCourier(
    transaction: Prisma.TransactionClient,
    courierId: string,
    proofId: string,
    status: PaymentProofStatus,
  ) {
    const courier = await transaction.courierProfile.findUniqueOrThrow({
      where: { id: courierId },
      select: { userId: true },
    });
    await this.notifications.create(transaction, {
      recipientUserId: courier.userId,
      type: `PAYMENT_PROOF_${status}`,
      title: 'تحديث إثبات الدفع',
      body: `تم تحديث حالة إثبات الدفع إلى ${status}.`,
      relatedEntityType: 'CourierPaymentProof',
      relatedEntityId: proofId,
      deepLink: `/account/payment-proofs/${proofId}`,
      deduplicationKey: `payment-proof:${proofId}:${status}:${courier.userId}`,
    });
    this.realtime.publish(`courier:${courierId}`, 'payment-proof.updated', {
      proofId,
      status,
    });
  }
}
