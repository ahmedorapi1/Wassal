export const requiredCourierDocumentTypes = [
  'NATIONAL_ID_FRONT',
  'NATIONAL_ID_BACK',
  'DRIVER_LICENSE',
  'VEHICLE_LICENSE',
  'PROFILE_PHOTO',
] as const;

export type EligibilityInput = {
  accountStatus: string;
  verificationStatus: string;
  hasActiveMotorcycle: boolean;
  documents: readonly {
    type: string;
    status: string;
    expiresAt: Date | null;
    isCurrent: boolean;
  }[];
  now?: Date;
};

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

export function courierOperationalEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  if (input.accountStatus !== 'ACTIVE') reasons.push('account_not_active');
  if (input.verificationStatus !== 'APPROVED') {
    reasons.push('courier_not_approved');
  }
  if (!input.hasActiveMotorcycle) reasons.push('active_motorcycle_required');

  for (const type of requiredCourierDocumentTypes) {
    const document = input.documents.find(
      (candidate) => candidate.isCurrent && candidate.type === type,
    );
    if (!document) {
      reasons.push(`missing_${type.toLowerCase()}`);
      continue;
    }
    if (document.status !== 'APPROVED') {
      reasons.push(`unapproved_${type.toLowerCase()}`);
    }
    if (document.expiresAt && document.expiresAt < now) {
      reasons.push(`expired_${type.toLowerCase()}`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

export function assertRecognizedDocumentSignature(
  bytes: Buffer,
  contentType: string,
): void {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const isPdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  const matches =
    (contentType === 'image/jpeg' && isJpeg) ||
    (contentType === 'image/png' && isPng) ||
    (contentType === 'application/pdf' && isPdf);
  if (!matches)
    throw new Error('File signature does not match its media type.');
}
