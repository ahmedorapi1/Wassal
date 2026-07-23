import { randomUUID } from 'node:crypto';

import type { OtpProvider, OtpPurpose } from './interfaces.js';

export class MockOtpProvider implements OtpProvider {
  public constructor(private readonly configuredCode: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MockOtpProvider cannot run in production.');
    }
  }

  public async request(_phone: string, _purpose: OtpPurpose, code: string) {
    if (code !== this.configuredCode) {
      throw new Error('Mock OTP code does not match local configuration.');
    }
    return { providerReference: randomUUID() };
  }
}
