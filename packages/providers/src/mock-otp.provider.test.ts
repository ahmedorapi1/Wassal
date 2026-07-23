import { describe, expect, it } from 'vitest';

import { MockOtpProvider } from './mock-otp.provider.js';

describe('MockOtpProvider', () => {
  it('accepts only the configured local dispatch code', async () => {
    const provider = new MockOtpProvider('123456');
    const { providerReference } = await provider.request(
      '+201001234567',
      'sign_in',
      '123456',
    );
    expect(providerReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await expect(
      provider.request('+201001234567', 'sign_in', '000000'),
    ).rejects.toThrow('does not match');
  });
});
