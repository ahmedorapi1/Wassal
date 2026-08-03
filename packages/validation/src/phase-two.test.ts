import { describe, expect, it } from 'vitest';

import {
  addressInputSchema,
  merchantCancellationSchema,
  quoteRequestSchema,
} from './index.js';

describe('Phase 2 validation', () => {
  it.each([
    ['010 1000 0001', '+201010000001'],
    ['201010000001', '+201010000001'],
    ['00201010000001', '+201010000001'],
  ])('normalizes customer and recipient phone %s', (input, expected) => {
    const address = addressInputSchema.parse({
      contactName: 'Synthetic Customer',
      contactPhone: input,
      addressLine: '25 Synthetic Street',
      area: 'Damietta',
      city: 'Damietta',
      governorate: 'Damietta',
      latitude: 31.4321,
      longitude: 31.8273,
    });
    expect(address.contactPhone).toBe(expected);
  });

  it('rejects coordinates outside the supported Egypt boundary', () => {
    expect(() =>
      addressInputSchema.parse({
        contactName: 'Synthetic Customer',
        contactPhone: '+201010000001',
        addressLine: '25 Synthetic Street',
        area: 'Damietta',
        city: 'Damietta',
        governorate: 'Damietta',
        latitude: 48.8566,
        longitude: 2.3522,
      }),
    ).toThrow();
  });

  it('accepts a valid coordinate-free Google Maps place reference', () => {
    expect(
      addressInputSchema.safeParse({
        contactName: 'Synthetic Customer',
        contactPhone: '+201010000001',
        addressLine: '25 Synthetic Street',
        area: 'Damietta',
        city: 'Damietta',
        governorate: 'Damietta',
        latitude: 31.4321,
        longitude: 31.8273,
        sourceMapsUrl: 'https://www.google.com/maps/place/Damietta',
      }).success,
    ).toBe(true);
  });

  it('requires explicit prohibited-item confirmation', () => {
    expect(() =>
      quoteRequestSchema.parse({
        storeId: '10000000-0000-4000-8000-000000000001',
        customer: {
          customerId: '70000000-0000-4000-8000-000000000001',
        },
        dropoff: {
          addressId: '81000000-0000-4000-8000-000000000002',
        },
        package: {
          category: 'documents',
          itemDescription: 'Synthetic documents',
          size: 'small',
          weightGrams: 500,
          packageCount: 1,
          fragile: false,
          requiresThermalBag: false,
          declaredValueMinor: 0,
          prohibitedItemsConfirmed: false,
        },
      }),
    ).toThrow();
  });

  it('requires details for the other cancellation reason', () => {
    expect(() =>
      merchantCancellationSchema.parse({
        reasonCode: 'other',
        version: 1,
      }),
    ).toThrow();
    expect(
      merchantCancellationSchema.parse({
        reasonCode: 'other',
        details: 'Synthetic reason details.',
        version: 1,
      }),
    ).toMatchObject({ reasonCode: 'other' });
  });
});
