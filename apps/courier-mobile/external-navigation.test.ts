import { describe, expect, it } from 'vitest';

import { externalNavigationUrl } from './external-navigation';

describe('external courier navigation links', () => {
  it('builds an external directions URL without requesting location access', () => {
    expect(
      externalNavigationUrl({ latitude: 31.4165, longitude: 31.8133 }),
    ).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=31.4165%2C31.8133',
    );
  });

  it('rejects invalid or non-finite coordinates', () => {
    expect(() =>
      externalNavigationUrl({ latitude: 91, longitude: 31 }),
    ).toThrow('إحداثيات العنوان غير صالحة.');
    expect(() =>
      externalNavigationUrl({ latitude: Number.NaN, longitude: 31 }),
    ).toThrow('إحداثيات العنوان غير صالحة.');
  });
});
