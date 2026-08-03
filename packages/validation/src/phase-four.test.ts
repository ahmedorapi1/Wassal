import { describe, expect, it } from 'vitest';

import {
  deliveryDisputeSchema,
  extractGoogleMapsCoordinates,
  phaseFourAddressFieldsSchema,
  passwordSchema,
} from './phase-four.js';

describe('Phase 4 validation', () => {
  it('extracts Egypt coordinates only from supported HTTPS Google Maps URLs', () => {
    expect(
      extractGoogleMapsCoordinates(
        'https://www.google.com/maps/place/Cairo/@30.0444,31.2357,15z',
      ),
    ).toEqual({ latitude: 30.0444, longitude: 31.2357 });
    expect(
      extractGoogleMapsCoordinates('http://maps.google.com/?q=30,31'),
    ).toBeNull();
    expect(
      extractGoogleMapsCoordinates('https://evil.example/?q=30,31'),
    ).toBeNull();
    expect(
      extractGoogleMapsCoordinates('https://maps.google.com/?q=80,31'),
    ).toBeNull();
  });

  it('preserves a valid Google place reference without visible coordinates', () => {
    expect(
      phaseFourAddressFieldsSchema.safeParse({
        sourceMapsUrl: 'https://www.google.com/maps/place/Damietta',
      }).success,
    ).toBe(true);
  });

  it('requires a note for an OTHER dispute', () => {
    expect(
      deliveryDisputeSchema.safeParse({
        version: 1,
        reason: 'OTHER',
      }).success,
    ).toBe(false);
  });

  it('enforces the pilot password policy', () => {
    expect(passwordSchema.safeParse('weak').success).toBe(false);
    expect(passwordSchema.safeParse('PilotSecure123').success).toBe(true);
  });
});
