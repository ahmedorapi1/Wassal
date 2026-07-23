import { describe, expect, it } from 'vitest';

import {
  assertRecognizedDocumentSignature,
  courierOperationalEligibility,
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
        'application/pdf',
      ),
    ).not.toThrow();
  });
});
