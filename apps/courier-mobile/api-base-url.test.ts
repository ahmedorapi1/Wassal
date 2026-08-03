import { describe, expect, it } from 'vitest';

import { resolveCourierApiUrl } from './api-base-url.js';

describe('courier Android API base URL', () => {
  it('uses an explicitly configured LAN URL', () => {
    expect(
      resolveCourierApiUrl(
        'http://192.168.100.30:3100/api/v1',
        undefined,
        'android',
      ),
    ).toBe('http://192.168.100.30:3100/api/v1');
  });

  it('derives the API host from Metro when stale config says localhost', () => {
    expect(
      resolveCourierApiUrl(
        'http://localhost:3100/api/v1',
        'http://192.168.100.30:8081/index.bundle?platform=android',
        'android',
      ),
    ).toBe('http://192.168.100.30:3100/api/v1');
  });

  it('fails fast instead of silently using localhost on Android', () => {
    expect(() =>
      resolveCourierApiUrl(
        undefined,
        'http://127.0.0.1:8081/index.bundle?platform=android',
        'android',
      ),
    ).toThrow('must use this computer LAN address');
  });
});
