import { describe, expect, it } from 'vitest';

import { egyptianPhoneSchema, normalizeEgyptianPhone } from './index.js';

describe('Egyptian phone normalization', () => {
  it.each([
    ['010 1234 5678', '+201012345678'],
    ['201012345678', '+201012345678'],
    ['00201012345678', '+201012345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeEgyptianPhone(input)).toBe(expected);
    expect(egyptianPhoneSchema.parse(input)).toBe(expected);
  });

  it('rejects non-Egyptian mobile numbers', () => {
    expect(egyptianPhoneSchema.safeParse('+12025550123').success).toBe(false);
  });
});
