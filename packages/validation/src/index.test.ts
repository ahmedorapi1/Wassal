import { describe, expect, it } from 'vitest';

import { coordinatesSchema, egyptianPhoneSchema } from './index.js';

describe('shared validation', () => {
  it('accepts E.164 Egyptian mobile numbers', () => {
    expect(egyptianPhoneSchema.parse('+201001234567')).toBe('+201001234567');
  });

  it('rejects invalid coordinates', () => {
    expect(() =>
      coordinatesSchema.parse({ latitude: 100, longitude: 31.2 }),
    ).toThrow();
  });
});
