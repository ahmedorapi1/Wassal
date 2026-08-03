import { describe, expect, it } from 'vitest';

import {
  assertRecognizedDocumentSignature,
  courierOperationalEligibility,
  eligibleServiceZoneIds,
  requiredCourierDocumentTypes,
} from './courier-policy.js';

describe('courier operational eligibility', () => {
  it('accepts an active approved courier with valid approved documents', () => {
    expect(
      courierOperationalEligibility({
        accountStatus: 'ACTIVE',
        verificationStatus: 'APPROVED',
        hasActiveMotorcycle: true,
        documents: requiredCourierDocumentTypes.map((type) => ({
          type,
          status: 'APPROVED',
          expiresAt: new Date('2030-01-01'),
          isCurrent: true,
        })),
        now: new Date('2026-01-01'),
      }),
    ).toEqual({ eligible: true, reasons: [] });
  });

  it('detects expired required documents without implementing availability', () => {
    const result = courierOperationalEligibility({
      accountStatus: 'ACTIVE',
      verificationStatus: 'APPROVED',
      hasActiveMotorcycle: true,
      documents: requiredCourierDocumentTypes.map((type) => ({
        type,
        status: 'APPROVED',
        expiresAt: type === 'DRIVER_LICENSE' ? new Date('2025-01-01') : null,
        isCurrent: true,
      })),
      now: new Date('2026-01-01'),
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('expired_driver_license');
  });

  it('uses only active courier memberships in active service zones', () => {
    expect(
      eligibleServiceZoneIds([
        {
          serviceZoneId: 'eligible',
          active: true,
          serviceZone: { status: 'ACTIVE' },
        },
        {
          serviceZoneId: 'membership-disabled',
          active: false,
          serviceZone: { status: 'ACTIVE' },
        },
        {
          serviceZoneId: 'zone-disabled',
          active: true,
          serviceZone: { status: 'INACTIVE' },
        },
      ]),
    ).toEqual(['eligible']);
  });

  it.each([
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png'],
    [Buffer.from('%PDF-1.4\n'), 'application/pdf'],
  ])('accepts recognized file signature for %s', (bytes, contentType) => {
    expect(() =>
      assertRecognizedDocumentSignature(bytes, contentType),
    ).not.toThrow();
  });

  it('rejects a file whose magic bytes do not match its media type', () => {
    expect(() =>
      assertRecognizedDocumentSignature(
        Buffer.from('<script>alert(1)</script>'),
        'application/pdf',
      ),
    ).toThrow('File signature');
    expect(() =>
      assertRecognizedDocumentSignature(
        Buffer.from('%PDF-1.4\n'),
        'image/jpeg',
      ),
    ).toThrow('File signature');
  });
});
