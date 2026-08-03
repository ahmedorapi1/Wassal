import { describe, expect, it, vi } from 'vitest';

import { CourierService } from './courier.service.js';

const profile = {
  id: '40000000-0000-4000-8000-000000000099',
  userId: '10000000-0000-4000-8000-000000000099',
  verificationStatus: 'DRAFT',
};

const pdf = {
  originalname: 'license.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\nservice test'),
  size: Buffer.byteLength('%PDF-1.4\nservice test'),
};

function serviceFixture(input?: {
  currentDocument?: Record<string, unknown> | null;
  transactionError?: Error;
}) {
  const storage = {
    createUploadUrl: vi.fn(),
    putObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    getObject: vi.fn(),
  };
  const database = {
    courierProfile: {
      findUnique: vi.fn().mockResolvedValue(profile),
    },
    courierDocument: {
      findFirst: vi.fn().mockResolvedValue(input?.currentDocument ?? null),
    },
    $transaction: vi
      .fn()
      .mockRejectedValue(input?.transactionError ?? new Error('DB failed')),
  };
  const service = new CourierService(database as never, storage, {
    DOCUMENT_MAX_BYTES: 5_242_880,
  } as never);
  return { database, service, storage };
}

describe('CourierService document persistence', () => {
  it('deletes the newly stored object when the database transaction fails', async () => {
    const fixture = serviceFixture({
      transactionError: new Error('Synthetic transaction failure'),
    });

    await expect(
      fixture.service.uploadDocument(
        profile.userId,
        { type: 'DRIVER_LICENSE', expiresAt: new Date('2030-12-31') },
        pdf,
      ),
    ).rejects.toThrow('Synthetic transaction failure');

    expect(fixture.storage.putObject).toHaveBeenCalledOnce();
    expect(fixture.storage.deleteObject).toHaveBeenCalledWith(
      fixture.storage.putObject.mock.calls[0]![0].objectKey,
    );
  });

  it('returns an identical current upload without storing another version', async () => {
    const expiresAt = new Date('2030-12-31');
    const fixture = serviceFixture({
      currentDocument: {
        id: '50000000-0000-4000-8000-000000000099',
        courierId: profile.id,
        type: 'DRIVER_LICENSE',
        status: 'PENDING',
        storageKey: `${profile.id}/existing`,
        originalFilename: pdf.originalname,
        contentType: pdf.mimetype,
        sizeBytes: pdf.size,
        checksumSha256:
          'fc0c91a66993964ca4ced19d7f34a9927a061d9290d43d646acb8e01a1535312',
        documentNumber: null,
        issuedAt: null,
        expiresAt,
        vehicleId: null,
        supersedesId: null,
        isCurrent: true,
      },
    });

    const result = await fixture.service.uploadDocument(
      profile.userId,
      { type: 'DRIVER_LICENSE', expiresAt },
      pdf,
    );

    expect(result.id).toBe('50000000-0000-4000-8000-000000000099');
    expect(result).not.toHaveProperty('storageKey');
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.database.$transaction).not.toHaveBeenCalled();
  });
});
