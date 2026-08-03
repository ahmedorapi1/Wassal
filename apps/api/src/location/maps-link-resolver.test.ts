import { describe, expect, it, vi } from 'vitest';

import {
  createPinnedLookup,
  isPublicIpAddress,
  MapsLinkResolutionError,
  resolveGoogleMapsLink,
} from './maps-link-resolver.js';

const publicLookup = vi.fn(async () => [
  { address: '142.250.74.206', family: 4 },
]);

describe('safe Google Maps link resolution', () => {
  it('supports Node single-address and all-address DNS callback modes', async () => {
    const pinned = { address: '142.250.74.206', family: 4 };
    const pinnedLookup = createPinnedLookup(pinned);
    await expect(
      new Promise((resolve, reject) =>
        pinnedLookup('maps.app.goo.gl', { all: true }, (error, addresses) =>
          error ? reject(error) : resolve(addresses),
        ),
      ),
    ).resolves.toEqual([pinned]);
    await expect(
      new Promise((resolve, reject) =>
        pinnedLookup('maps.app.goo.gl', { all: false }, (error, address) =>
          error ? reject(error) : resolve(address),
        ),
      ),
    ).resolves.toBe(pinned.address);
  });

  it('extracts explicit coordinates without making a network request', async () => {
    const requestUrl = vi.fn();
    await expect(
      resolveGoogleMapsLink(
        'https://www.google.com/maps/place/Damietta/@31.4321,31.8273,16z',
        { lookupHost: publicLookup, requestUrl },
      ),
    ).resolves.toMatchObject({
      status: 'COORDINATES_FOUND',
      latitude: 31.4321,
      longitude: 31.8273,
      extractionSource: 'EXPLICIT_COORDINATES',
    });
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it('pins and follows an allowlisted short-link redirect', async () => {
    const requestUrl = vi.fn(async () => ({
      statusCode: 302,
      location: 'https://www.google.com/maps/place/Damietta/@31.441,31.81,16z',
    }));
    await expect(
      resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
        lookupHost: publicLookup,
        requestUrl,
      }),
    ).resolves.toMatchObject({
      status: 'COORDINATES_FOUND',
      latitude: 31.441,
      longitude: 31.81,
      extractionSource: 'SHORT_LINK_REDIRECT',
    });
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://maps.app.goo.gl/example',
    'https://evil.example/maps?q=31.4,31.8',
    'https://127.0.0.1/maps?q=31.4,31.8',
    'not-a-url',
  ])('rejects unsupported input %s', async (value) => {
    await expect(resolveGoogleMapsLink(value)).rejects.toBeInstanceOf(
      MapsLinkResolutionError,
    );
  });

  it('rejects private, loopback, link-local, and metadata DNS results', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.2',
      '172.16.0.1',
      '192.168.1.5',
      '169.254.169.254',
      '::1',
      'fd00::1',
    ]) {
      await expect(
        resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
          lookupHost: async () => [
            { address, family: address.includes(':') ? 6 : 4 },
          ],
          requestUrl: vi.fn(),
        }),
      ).rejects.toThrow('safe public address');
    }
  });

  it('rejects redirects outside the allowlist and excessive redirects', async () => {
    await expect(
      resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
        lookupHost: publicLookup,
        requestUrl: async () => ({
          statusCode: 302,
          location: 'https://evil.example/redirect',
        }),
      }),
    ).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' });

    await expect(
      resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
        lookupHost: publicLookup,
        requestUrl: async () => ({
          statusCode: 302,
          location: 'https://maps.app.goo.gl/again',
        }),
      }),
    ).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' });
  });

  it('returns a structured manual-selection result for a safe short link without coordinates', async () => {
    await expect(
      resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
        lookupHost: publicLookup,
        requestUrl: async () => ({ statusCode: 200 }),
      }),
    ).resolves.toMatchObject({
      originalUrl: 'https://maps.app.goo.gl/example',
      status: 'MANUAL_SELECTION_REQUIRED',
      latitude: null,
      longitude: null,
      extractionSource: 'MANUAL_SELECTION_REQUIRED',
      userMessage: 'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.',
    });
  });

  it.each([
    'https://www.google.com/maps/place/Damietta',
    'https://www.google.com/maps/search/Damietta',
    'https://www.google.com/maps/search/?api=1&query=Damietta',
    'https://www.google.com/maps/place/?query_place_id=ChIJ_example',
  ])(
    'accepts a valid Google Maps reference without visible coordinates: %s',
    async (url) => {
      await expect(resolveGoogleMapsLink(url)).resolves.toMatchObject({
        normalizedUrl: new URL(url).href,
        originalUrl: new URL(url).href,
        status: 'MANUAL_SELECTION_REQUIRED',
        latitude: null,
        longitude: null,
      });
    },
  );

  it('distinguishes an allowlisted Google page with no location', async () => {
    await expect(
      resolveGoogleMapsLink('https://www.google.com/maps'),
    ).rejects.toMatchObject({ code: 'NO_LOCATION' });
  });

  it('classifies a short-link timeout without leaking a network error', async () => {
    await expect(
      resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
        lookupHost: publicLookup,
        requestUrl: async () => {
          throw new MapsLinkResolutionError(
            'RESOLUTION_TIMEOUT',
            'socket timeout details',
          );
        },
      }),
    ).rejects.toMatchObject({ code: 'RESOLUTION_TIMEOUT' });
  });

  it('classifies an ordinary resolution failure as a network failure', async () => {
    await expect(
      resolveGoogleMapsLink('https://maps.app.goo.gl/example', {
        lookupHost: publicLookup,
        requestUrl: async () => {
          throw new Error('ECONNRESET');
        },
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_FAILURE' });
  });

  it('classifies public and blocked IP ranges', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('2607:f8b0:4004:800::200e')).toBe(true);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
  });
});
