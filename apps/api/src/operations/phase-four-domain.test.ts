import { describe, expect, it } from 'vitest';

import {
  deliveryDisputeDeadline,
  deliveryMayAutoComplete,
  disputeWindowIsActive,
  notificationDeduplicationKey,
  paymentProofApproval,
  proofDuplicateIndicators,
} from './phase-four-domain.js';

describe('Phase 4 delivery domain', () => {
  it('snapshots a 24-hour Cairo operational deadline as an instant', () => {
    const deliveredAt = new Date('2026-07-27T09:00:00+03:00');
    expect(deliveryDisputeDeadline(deliveredAt, 24).toISOString()).toBe(
      '2026-07-28T06:00:00.000Z',
    );
  });

  it('permits one live delivered dispute and rejects expired/open cases', () => {
    const now = new Date('2026-07-27T08:00:00Z');
    expect(
      disputeWindowIsActive({
        status: 'DELIVERED',
        deadline: new Date('2026-07-28T08:00:00Z'),
        now,
        hasDispute: false,
      }),
    ).toBe(true);
    expect(
      disputeWindowIsActive({
        status: 'DELIVERED',
        deadline: now,
        now,
        hasDispute: false,
      }),
    ).toBe(false);
    expect(
      disputeWindowIsActive({
        status: 'DELIVERED',
        deadline: new Date('2026-07-28T08:00:00Z'),
        now,
        hasDispute: true,
      }),
    ).toBe(false);
  });

  it('blocks automatic financial completion while a dispute is open', () => {
    const input = {
      status: 'DELIVERED',
      deadline: new Date('2026-07-26T08:00:00Z'),
      now: new Date('2026-07-27T08:00:00Z'),
      financialFinalized: false,
    };
    expect(deliveryMayAutoComplete({ ...input, hasOpenDispute: false })).toBe(
      true,
    );
    expect(deliveryMayAutoComplete({ ...input, hasOpenDispute: true })).toBe(
      false,
    );
  });
});

describe('Phase 4 proof and notification domain', () => {
  it('supports full and reasoned partial approvals only', () => {
    expect(
      paymentProofApproval({
        submittedAmountMinor: 1_000,
        approvedAmountMinor: 1_000,
      }),
    ).toBe('APPROVED');
    expect(
      paymentProofApproval({
        submittedAmountMinor: 1_000,
        approvedAmountMinor: 700,
        reason: 'Receipt shows 7 EGP.',
      }),
    ).toBe('PARTIALLY_APPROVED');
    expect(() =>
      paymentProofApproval({
        submittedAmountMinor: 1_000,
        approvedAmountMinor: 700,
      }),
    ).toThrow('partial_approval_reason_required');
    expect(() =>
      paymentProofApproval({
        submittedAmountMinor: 1_000,
        approvedAmountMinor: 1_001,
      }),
    ).toThrow('invalid_approved_amount');
  });

  it('treats duplicate indicators as warnings, not fraud proof', () => {
    expect(
      proofDuplicateIndicators({
        checksumMatches: true,
        referenceMatches: false,
        sameCourierAmountDate: false,
      }),
    ).toMatchObject({ warningOnly: true, possibleDuplicate: true });
  });

  it('builds a stable recipient-scoped notification key', () => {
    expect(notificationDeduplicationKey('ORDER_COMPLETED', 'o1', 'u1')).toBe(
      'ORDER_COMPLETED:o1:u1',
    );
  });
});
