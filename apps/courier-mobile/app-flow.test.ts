import { describe, expect, it } from 'vitest';

import { courierScreenForState } from './app-flow.js';

describe('courier Phase 1 onboarding navigation', () => {
  it('routes incomplete onboarding through vehicle, documents, and review', () => {
    expect(
      courierScreenForState({
        status: 'incomplete',
        vehicleCount: 0,
        documentCount: 0,
        requiredDocumentCount: 5,
      }),
    ).toBe('vehicle');
    expect(
      courierScreenForState({
        status: 'incomplete',
        vehicleCount: 1,
        documentCount: 3,
        requiredDocumentCount: 5,
      }),
    ).toBe('documents');
    expect(
      courierScreenForState({
        status: 'incomplete',
        vehicleCount: 1,
        documentCount: 5,
        requiredDocumentCount: 5,
      }),
    ).toBe('review');
  });

  it('returns reviewed states to status without exposing delivery availability', () => {
    expect(
      courierScreenForState({
        status: 'approved',
        vehicleCount: 1,
        documentCount: 5,
        requiredDocumentCount: 5,
      }),
    ).toBe('status');
  });
});
