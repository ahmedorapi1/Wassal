export function deliveryDisputeDeadline(
  deliveredAt: Date,
  windowHours: number,
): Date {
  if (!Number.isInteger(windowHours) || windowHours < 1) {
    throw new Error('invalid_dispute_window');
  }
  return new Date(deliveredAt.getTime() + windowHours * 60 * 60 * 1_000);
}

export function disputeWindowIsActive(input: {
  status: string;
  deadline: Date | null;
  now: Date;
  hasDispute: boolean;
}): boolean {
  return (
    input.status === 'DELIVERED' &&
    input.deadline !== null &&
    input.deadline > input.now &&
    !input.hasDispute
  );
}

export function deliveryMayAutoComplete(input: {
  status: string;
  deadline: Date | null;
  now: Date;
  hasOpenDispute: boolean;
  financialFinalized: boolean;
}): boolean {
  return (
    input.status === 'DELIVERED' &&
    input.deadline !== null &&
    input.deadline <= input.now &&
    !input.hasOpenDispute &&
    !input.financialFinalized
  );
}

export function paymentProofApproval(input: {
  submittedAmountMinor: number;
  approvedAmountMinor: number;
  reason?: string;
}): 'APPROVED' | 'PARTIALLY_APPROVED' {
  if (
    !Number.isInteger(input.approvedAmountMinor) ||
    input.approvedAmountMinor <= 0 ||
    input.approvedAmountMinor > input.submittedAmountMinor
  ) {
    throw new Error('invalid_approved_amount');
  }
  if (
    input.approvedAmountMinor !== input.submittedAmountMinor &&
    !input.reason?.trim()
  ) {
    throw new Error('partial_approval_reason_required');
  }
  return input.approvedAmountMinor === input.submittedAmountMinor
    ? 'APPROVED'
    : 'PARTIALLY_APPROVED';
}

export function proofDuplicateIndicators(input: {
  checksumMatches: boolean;
  referenceMatches: boolean;
  sameCourierAmountDate: boolean;
}) {
  return {
    ...input,
    warningOnly: true as const,
    possibleDuplicate:
      input.checksumMatches ||
      input.referenceMatches ||
      input.sameCourierAmountDate,
  };
}

export function notificationDeduplicationKey(
  type: string,
  entityId: string,
  recipientUserId: string,
): string {
  return `${type}:${entityId}:${recipientUserId}`;
}
