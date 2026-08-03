import { describe, expect, it } from 'vitest';

import { quoteInputFingerprint, quoteMatchesInput } from './quote-input';

const input = {
  addressIdentity: 'temporary:MAP_PICKER',
  category: 'food',
  customerIdentity: 'customer-1',
  declaredValueMinor: 10_000,
  fragile: false,
  latitude: 31.4321,
  longitude: 31.8273,
  packageCount: 1,
  packageSize: 'small',
  storeId: 'store-1',
  thermalBag: false,
  weightGrams: 1_000,
};

describe('merchant quote input fingerprint', () => {
  it('is stable for the same pricing and location input', () => {
    expect(quoteInputFingerprint({ ...input })).toBe(
      quoteInputFingerprint({ ...input }),
    );
  });

  it.each([
    { latitude: 31.44 },
    { longitude: 31.81 },
    { addressIdentity: 'saved-address-2' },
    { customerIdentity: 'customer-2' },
    { storeId: 'store-2' },
    { packageSize: 'large' },
    { weightGrams: 5_000 },
    { fragile: true },
    { thermalBag: true },
  ])('invalidates the quote after changing %o', (change) => {
    const fingerprint = quoteInputFingerprint(input);
    expect(quoteMatchesInput(fingerprint, { ...input, ...change })).toBe(false);
  });

  it('prevents a location-A quote from matching location B', () => {
    const locationAQuote = quoteInputFingerprint(input);
    expect(
      quoteMatchesInput(locationAQuote, {
        ...input,
        latitude: 31.455,
        longitude: 31.79,
      }),
    ).toBe(false);
  });

  it('invalidates an existing quote when the confirmed marker changes', () => {
    const confirmedQuote = quoteInputFingerprint(input);
    const movedMarker = {
      ...input,
      latitude: 31.49,
      longitude: 31.72,
    };
    expect(quoteMatchesInput(confirmedQuote, movedMarker)).toBe(false);
    expect(quoteInputFingerprint(movedMarker)).not.toBe(confirmedQuote);
  });
});
