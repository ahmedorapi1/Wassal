import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServerEnvironment } from '@wasel/config';
import type { Role } from '@wasel/contracts';
import type { DocumentType, PrismaClient } from '@wasel/database';
import type { ObjectStorageProvider } from '@wasel/providers';
import { normalizeEgyptianPhone } from '@wasel/validation';
import { createHash, randomUUID } from 'node:crypto';

import { writeAudit } from '../infrastructure/audit.js';
import {
  DATABASE,
  ENVIRONMENT,
  OBJECT_STORAGE,
} from '../infrastructure/tokens.js';
import {
  assertRecognizedDocumentSignature,
  courierOperationalEligibility,
  requiredCourierDocumentTypes,
} from './courier-policy.js';

type DocumentInput = {
  type: DocumentType;
  documentNumber?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  vehicleId?: string;
};

type UploadedDocument = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const editableStatuses = new Set(['INCOMPLETE', 'DRAFT', 'CHANGES_REQUESTED']);

@Injectable()
export class CourierService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStorageProvider,
    @Inject(ENVIRONMENT) private readonly environment: ServerEnvironment,
  ) {}

  public async createProfile(
    userId: string,
    input: {
      fullName: string;
      preferredCity?: string;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
    },
  ) {
    const exists = await this.database.courierProfile.findUnique({
      where: { userId },
    });
    if (exists) throw new ConflictException('Courier profile already exists.');
    return this.database.$transaction(async (transaction) => {
      const profile = await transaction.courierProfile.create({
        data: {
          userId,
          fullName: input.fullName,
          ...(input.preferredCity
            ? { preferredCity: input.preferredCity }
            : {}),
          ...(input.emergencyContactName
            ? { emergencyContactName: input.emergencyContactName }
            : {}),
          ...(input.emergencyContactPhone
            ? {
                emergencyContactPhone: normalizeEgyptianPhone(
                  input.emergencyContactPhone,
                ),
              }
            : {}),
        },
      });
      await transaction.user.update({
        where: { id: userId },
        data: { displayName: input.fullName, role: 'COURIER' },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'COURIER',
        action: 'courier_profile.created',
        entityType: 'CourierProfile',
        entityId: profile.id,
      });
      return profile;
    });
  }

  public async profile(userId: string) {
    return this.profileForUser(userId);
  }

  public async updateProfile(
    userId: string,
    input: {
      fullName?: string;
      preferredCity?: string;
      emergencyContactName?: string | null;
      emergencyContactPhone?: string | null;
      version: number;
    },
  ) {
    const profile = await this.profileForUser(userId);
    this.assertEditable(profile.verificationStatus);
    const { version, ...fields } = input;
    await this.database.$transaction(async (transaction) => {
      const result = await transaction.courierProfile.updateMany({
        where: { id: profile.id, version },
        data: {
          ...fields,
          ...(fields.emergencyContactPhone
            ? {
                emergencyContactPhone: normalizeEgyptianPhone(
                  fields.emergencyContactPhone,
                ),
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('Profile was updated.');
      }
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'COURIER',
        action: 'courier_profile.updated',
        entityType: 'CourierProfile',
        entityId: profile.id,
      });
    });
    return this.profileForUser(userId);
  }

  public async addVehicle(
    userId: string,
    input: {
      plateNumber: string;
      manufacturer?: string;
      model?: string;
      color?: string;
    },
  ) {
    const profile = await this.profileForUser(userId);
    this.assertEditable(profile.verificationStatus);
    return this.database.$transaction(async (transaction) => {
      const vehicle = await transaction.vehicle.create({
        data: {
          courierId: profile.id,
          type: 'MOTORCYCLE',
          ...input,
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'COURIER',
        action: 'courier_vehicle.created',
        entityType: 'Vehicle',
        entityId: vehicle.id,
      });
      return vehicle;
    });
  }

  public async vehicles(userId: string) {
    const profile = await this.profileForUser(userId);
    return this.database.vehicle.findMany({
      where: { courierId: profile.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async updateVehicle(
    userId: string,
    vehicleId: string,
    input: {
      plateNumber?: string;
      manufacturer?: string | null;
      model?: string | null;
      color?: string | null;
      active?: boolean;
      version: number;
    },
  ) {
    const profile = await this.profileForUser(userId);
    this.assertEditable(profile.verificationStatus);
    const { version, ...data } = input;
    await this.database.$transaction(async (transaction) => {
      const result = await transaction.vehicle.updateMany({
        where: { id: vehicleId, courierId: profile.id, version },
        data: { ...data, type: 'MOTORCYCLE', version: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw new ConflictException('Vehicle was not found or was updated.');
      }
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'COURIER',
        action: 'courier_vehicle.updated',
        entityType: 'Vehicle',
        entityId: vehicleId,
      });
    });
    return this.database.vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
  }

  public async uploadDocument(
    userId: string,
    input: DocumentInput,
    file: UploadedDocument | undefined,
    supersedesId?: string,
  ) {
    if (!file) throw new BadRequestException('A document file is required.');
    if (file.size > this.environment.DOCUMENT_MAX_BYTES) {
      throw new BadRequestException('Document exceeds the upload size limit.');
    }
    try {
      assertRecognizedDocumentSignature(file.buffer, file.mimetype);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const profile = await this.profileForUser(userId);
    this.assertEditable(profile.verificationStatus);
    if (
      input.type === 'VEHICLE_LICENSE' &&
      (!input.vehicleId ||
        !(await this.database.vehicle.findFirst({
          where: { id: input.vehicleId, courierId: profile.id },
        })))
    ) {
      throw new BadRequestException('A valid courier vehicle is required.');
    }

    const storageKey = `${profile.id}/${randomUUID()}`;
    await this.storage.putObject({
      objectKey: storageKey,
      contentType: file.mimetype,
      bytes: file.buffer,
    });
    const checksumSha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex');
    return this.database.$transaction(async (transaction) => {
      if (supersedesId) {
        const previous = await transaction.courierDocument.findFirst({
          where: {
            id: supersedesId,
            courierId: profile.id,
            isCurrent: true,
          },
        });
        if (!previous) {
          throw new NotFoundException('Current document was not found.');
        }
        if (previous.type !== input.type) {
          throw new BadRequestException(
            'Replacement must use the same document type.',
          );
        }
        await transaction.courierDocument.update({
          where: { id: previous.id },
          data: {
            isCurrent: false,
            status: 'SUPERSEDED',
            version: { increment: 1 },
          },
        });
      } else {
        const current = await transaction.courierDocument.findFirst({
          where: { courierId: profile.id, type: input.type, isCurrent: true },
        });
        if (current) {
          throw new ConflictException(
            'Use the replacement endpoint for this document type.',
          );
        }
      }
      const document = await transaction.courierDocument.create({
        data: {
          courierId: profile.id,
          type: input.type,
          storageKey,
          originalFilename: file.originalname.slice(0, 255),
          contentType: file.mimetype,
          sizeBytes: file.size,
          checksumSha256,
          ...(input.documentNumber
            ? { documentNumber: input.documentNumber }
            : {}),
          ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
          ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
          ...(supersedesId ? { supersedesId } : {}),
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'COURIER',
        action: supersedesId
          ? 'courier_document.replaced'
          : 'courier_document.uploaded',
        entityType: 'CourierDocument',
        entityId: document.id,
      });
      return this.safeDocument(document);
    });
  }

  public async documents(userId: string) {
    const profile = await this.profileForUser(userId);
    const documents = await this.database.courierDocument.findMany({
      where: { courierId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((document) => this.safeDocument(document));
  }

  public async documentFile(
    requesterId: string,
    role: Role,
    documentId: string,
  ) {
    const document = await this.database.courierDocument.findUnique({
      where: { id: documentId },
      include: { courier: true },
    });
    if (!document) throw new NotFoundException('Document was not found.');
    const isReviewer = role === 'operations_admin' || role === 'super_admin';
    if (!isReviewer && document.courier.userId !== requesterId) {
      throw new ForbiddenException('Document access is not allowed.');
    }
    const object = await this.storage.getObject(document.storageKey);
    return {
      bytes: object.bytes,
      contentType: document.contentType,
      filename: document.originalFilename,
    };
  }

  public async submitForReview(userId: string) {
    const profile = await this.profileForUser(userId);
    this.assertEditable(profile.verificationStatus);
    const [documents, vehicle] = await Promise.all([
      this.database.courierDocument.findMany({
        where: { courierId: profile.id, isCurrent: true },
      }),
      this.database.vehicle.findFirst({
        where: { courierId: profile.id, active: true, type: 'MOTORCYCLE' },
      }),
    ]);
    const missing = requiredCourierDocumentTypes.filter(
      (type) => !documents.some((document) => document.type === type),
    );
    if (!vehicle || missing.length > 0) {
      throw new BadRequestException({
        message: 'Courier onboarding is incomplete.',
        missing,
        vehicleRequired: !vehicle,
      });
    }
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.courierProfile.updateMany({
        where: { id: profile.id, version: profile.version },
        data: {
          verificationStatus: 'PENDING_REVIEW',
          submittedAt: new Date(),
          statusReason: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('Courier application was updated.');
      }
      await transaction.courierVerificationEvent.create({
        data: {
          courierId: profile.id,
          actorId: userId,
          action: 'submitted',
          fromStatus: profile.verificationStatus,
          toStatus: 'PENDING_REVIEW',
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'COURIER',
        action: 'courier.submitted',
        entityType: 'CourierProfile',
        entityId: profile.id,
      });
      return { verificationStatus: 'pending_review' };
    });
  }

  public async verificationStatus(userId: string) {
    const profile = await this.profileForUser(userId);
    const [documents, vehicle, user] = await Promise.all([
      this.database.courierDocument.findMany({
        where: { courierId: profile.id, isCurrent: true },
      }),
      this.database.vehicle.findFirst({
        where: { courierId: profile.id, active: true, type: 'MOTORCYCLE' },
      }),
      this.database.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    return {
      status: profile.verificationStatus.toLowerCase(),
      reason: profile.statusReason,
      eligibility: courierOperationalEligibility({
        accountStatus: user.status,
        verificationStatus: profile.verificationStatus,
        hasActiveMotorcycle: Boolean(vehicle),
        documents,
      }),
    };
  }

  private async profileForUser(userId: string) {
    const profile = await this.database.courierProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Courier profile was not found.');
    return profile;
  }

  private assertEditable(status: string): void {
    if (!editableStatuses.has(status)) {
      throw new ConflictException(
        'Submitted information cannot be edited in this state.',
      );
    }
  }

  private safeDocument<T extends { storageKey: string }>(
    document: T,
  ): Omit<T, 'storageKey'> {
    const { storageKey: _storageKey, ...safe } = document;
    return safe;
  }
}
