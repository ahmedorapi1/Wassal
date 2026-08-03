import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import {
  extractGoogleMapsCoordinates,
  isSupportedGoogleMapsReference,
} from '@wasel/validation/google-maps';

const allowedGoogleMapsHosts = new Set([
  'google.com',
  'maps.app.goo.gl',
  'maps.google.com',
  'www.google.com',
]);
const shortGoogleMapsHosts = new Set(['maps.app.goo.gl']);
const maximumRedirects = 3;
const maximumResponseBytes = 16 * 1024;
const requestTimeoutMilliseconds = 3_500;

type LookupResult = { address: string; family: number };
type SafeResponse = {
  statusCode: number;
  location?: string;
};

export type MapsLinkResolverDependencies = {
  lookupHost?: (hostname: string) => Promise<LookupResult[]>;
  requestUrl?: (url: URL, pinnedAddress: LookupResult) => Promise<SafeResponse>;
};

export type ResolvedMapsLink = {
  normalizedUrl: string;
  originalUrl: string;
  status: 'COORDINATES_FOUND' | 'MANUAL_SELECTION_REQUIRED';
  latitude: number | null;
  longitude: number | null;
  extractionSource:
    | 'EXPLICIT_COORDINATES'
    | 'SHORT_LINK_REDIRECT'
    | 'MANUAL_SELECTION_REQUIRED';
  userMessage: string | null;
};

export type MapsLinkResolutionErrorCode =
  | 'UNSUPPORTED_LINK'
  | 'NO_LOCATION'
  | 'RESOLUTION_TIMEOUT'
  | 'REDIRECT_BLOCKED'
  | 'NETWORK_FAILURE';

export class MapsLinkResolutionError extends Error {
  public constructor(
    public readonly code: MapsLinkResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MapsLinkResolutionError';
  }
}

const manualSelectionMessage =
  'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.';

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [first = 0, second = 0] = address.split('.').map(Number);
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      return isPublicIpAddress(normalized.slice('::ffff:'.length));
    }
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith('ff')
    );
  }
  return false;
}

function parseAllowedUrl(value: string): URL {
  if (value.length > 1_000) {
    throw new MapsLinkResolutionError(
      'UNSUPPORTED_LINK',
      'The Google Maps link is too long.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MapsLinkResolutionError(
      'UNSUPPORTED_LINK',
      'Enter a valid Google Maps URL.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    !allowedGoogleMapsHosts.has(url.hostname.toLowerCase())
  ) {
    throw new MapsLinkResolutionError(
      'UNSUPPORTED_LINK',
      'Only approved HTTPS Google Maps links are supported.',
    );
  }
  if (url.username || url.password || url.port) {
    throw new MapsLinkResolutionError(
      'UNSUPPORTED_LINK',
      'Google Maps links cannot contain credentials or a custom port.',
    );
  }
  return url;
}

async function defaultLookupHost(hostname: string): Promise<LookupResult[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

export function createPinnedLookup(
  pinnedAddress: LookupResult,
): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [pinnedAddress]);
      return;
    }
    callback(null, pinnedAddress.address, pinnedAddress.family);
  };
}

async function defaultRequestUrl(
  url: URL,
  pinnedAddress: LookupResult,
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: {
          Accept: 'text/html;q=0.8,*/*;q=0.1',
          Range: `bytes=0-${maximumResponseBytes - 1}`,
          'User-Agent': 'SKKA-Maps-Link-Resolver/1.0',
        },
        lookup: createPinnedLookup(pinnedAddress),
        method: 'GET',
      },
      (response) => {
        let receivedBytes = 0;
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maximumResponseBytes) {
            request.destroy(
              new MapsLinkResolutionError(
                'NETWORK_FAILURE',
                'The Google Maps response exceeded the safe size limit.',
              ),
            );
          }
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            location:
              typeof response.headers.location === 'string'
                ? response.headers.location
                : undefined,
          });
        });
      },
    );
    request.setTimeout(requestTimeoutMilliseconds, () => {
      request.destroy(
        new MapsLinkResolutionError(
          'RESOLUTION_TIMEOUT',
          'The Google Maps link resolution timed out.',
        ),
      );
    });
    request.on('error', reject);
    request.end();
  });
}

export async function resolveGoogleMapsLink(
  value: string,
  dependencies: MapsLinkResolverDependencies = {},
): Promise<ResolvedMapsLink> {
  const originalUrl = parseAllowedUrl(value.trim()).href;
  let current = new URL(originalUrl);
  const direct = extractGoogleMapsCoordinates(current.href);
  if (direct) {
    return {
      normalizedUrl: current.href,
      originalUrl,
      status: 'COORDINATES_FOUND',
      ...direct,
      extractionSource: 'EXPLICIT_COORDINATES',
      userMessage: null,
    };
  }
  if (!shortGoogleMapsHosts.has(current.hostname.toLowerCase())) {
    if (!isSupportedGoogleMapsReference(current.href)) {
      throw new MapsLinkResolutionError(
        'NO_LOCATION',
        'This Google Maps link does not identify a place or location.',
      );
    }
    return {
      normalizedUrl: current.href,
      originalUrl,
      status: 'MANUAL_SELECTION_REQUIRED',
      latitude: null,
      longitude: null,
      extractionSource: 'MANUAL_SELECTION_REQUIRED',
      userMessage: manualSelectionMessage,
    };
  }

  const lookupHost = dependencies.lookupHost ?? defaultLookupHost;
  const requestUrl = dependencies.requestUrl ?? defaultRequestUrl;
  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    let addresses: LookupResult[];
    try {
      addresses = await lookupHost(current.hostname);
    } catch (error) {
      throw new MapsLinkResolutionError(
        'NETWORK_FAILURE',
        error instanceof Error
          ? `Google Maps DNS lookup failed: ${error.message}`
          : 'Google Maps DNS lookup failed.',
      );
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicIpAddress(address))
    ) {
      throw new MapsLinkResolutionError(
        'REDIRECT_BLOCKED',
        'The Google Maps hostname did not resolve to a safe public address.',
      );
    }
    let response: SafeResponse;
    try {
      response = await requestUrl(current, addresses[0]!);
    } catch (error) {
      if (error instanceof MapsLinkResolutionError) throw error;
      throw new MapsLinkResolutionError(
        'NETWORK_FAILURE',
        error instanceof Error
          ? `Google Maps request failed: ${error.message}`
          : 'Google Maps request failed.',
      );
    }
    if (
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.location
    ) {
      if (redirect === maximumRedirects) {
        throw new MapsLinkResolutionError(
          'REDIRECT_BLOCKED',
          'The Google Maps link used too many redirects.',
        );
      }
      try {
        current = parseAllowedUrl(new URL(response.location, current).href);
      } catch (error) {
        if (error instanceof MapsLinkResolutionError) {
          throw new MapsLinkResolutionError(
            'REDIRECT_BLOCKED',
            'The Google Maps redirect target was blocked.',
          );
        }
        throw error;
      }
      const coordinates = extractGoogleMapsCoordinates(current.href);
      if (coordinates) {
        return {
          normalizedUrl: current.href,
          originalUrl,
          status: 'COORDINATES_FOUND',
          ...coordinates,
          extractionSource: 'SHORT_LINK_REDIRECT',
          userMessage: null,
        };
      }
      continue;
    }
    if (response.statusCode >= 400) {
      throw new MapsLinkResolutionError(
        'NETWORK_FAILURE',
        'Google Maps did not return a usable response.',
      );
    }
    break;
  }

  if (
    isSupportedGoogleMapsReference(current.href) ||
    shortGoogleMapsHosts.has(current.hostname.toLowerCase())
  ) {
    return {
      normalizedUrl: current.href,
      originalUrl,
      status: 'MANUAL_SELECTION_REQUIRED',
      latitude: null,
      longitude: null,
      extractionSource: 'MANUAL_SELECTION_REQUIRED',
      userMessage: manualSelectionMessage,
    };
  }
  throw new MapsLinkResolutionError(
    'NO_LOCATION',
    'This Google Maps link does not identify a place or location.',
  );
}
