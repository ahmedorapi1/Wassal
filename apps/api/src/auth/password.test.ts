import { describe, expect, it } from 'vitest';

import { hashPassword, temporaryPassword, verifyPassword } from './password.js';

describe('pilot password security', () => {
  it('stores a salted scrypt hash and verifies without exposing plaintext', async () => {
    const hash = await hashPassword('PilotSecure123');
    expect(hash).not.toContain('PilotSecure123');
    expect(await verifyPassword('PilotSecure123', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('generates policy-compatible temporary passwords', () => {
    const password = temporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(10);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/\d/);
  });
});
