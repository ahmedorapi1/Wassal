import { describe, expect, it } from 'vitest';

import { parseEnvironment, serverEnvironmentSchema } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/wassal',
  REDIS_URL: 'redis://localhost:6379',
  OTP_MOCK_CODE: '123456',
  OTP_PEPPER: 'x'.repeat(32),
  ACCESS_TOKEN_SECRET: 'y'.repeat(32),
};

describe('Phase 4 production environment validation', () => {
  it('keeps pilot merchant registration disabled unless explicitly enabled', () => {
    expect(
      parseEnvironment(serverEnvironmentSchema, base)
        .MERCHANT_PILOT_REGISTRATION_ENABLED,
    ).toBe(false);
    expect(
      parseEnvironment(serverEnvironmentSchema, {
        ...base,
        MERCHANT_PILOT_REGISTRATION_ENABLED: 'true',
      }).MERCHANT_PILOT_REGISTRATION_ENABLED,
    ).toBe(true);
  });

  it('rejects local storage and wildcard CORS in production', () => {
    expect(() =>
      parseEnvironment(serverEnvironmentSchema, {
        ...base,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        STORAGE_DRIVER: 'local',
        CORS_ORIGINS: '*',
      }),
    ).toThrow(/private S3-compatible object storage/);
  });

  it('accepts an explicit production allowlist and private S3 configuration', () => {
    const environment = parseEnvironment(serverEnvironmentSchema, {
      ...base,
      NODE_ENV: 'production',
      APP_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_REGION: 'eu-central-1',
      S3_BUCKET: 'wassal-private',
      S3_ACCESS_KEY_ID: 'placeholder',
      S3_SECRET_ACCESS_KEY: 'placeholder',
      S3_PREFIX: 'production',
      CORS_ORIGINS: 'https://merchant.example.test,https://admin.example.test',
      TRUST_PROXY: 'true',
    });
    expect(environment.STORAGE_DRIVER).toBe('s3');
    expect(environment.TRUST_PROXY).toBe(true);
  });
});
