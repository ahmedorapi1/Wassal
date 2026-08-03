const supportedGoogleMapsHosts = new Set([
  'maps.app.goo.gl',
  'maps.google.com',
  'www.google.com',
  'google.com',
]);

export type GoogleMapsReferenceKind =
  'COORDINATES' | 'PLACE' | 'SEARCH' | 'PLACE_IDENTIFIER' | 'SHORT_LINK';

function parseSupportedGoogleMapsUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    !supportedGoogleMapsHosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }
  return url;
}

function validEgyptCoordinates(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } | null {
  if (
    Number.isFinite(latitude) &&
    latitude >= 22 &&
    latitude <= 31.7 &&
    Number.isFinite(longitude) &&
    longitude >= 24.6 &&
    longitude <= 36.9
  ) {
    return { latitude, longitude };
  }
  return null;
}

function coordinatesFromText(value: string) {
  const match = value.match(
    /(?:^|[^\d.-])(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?:$|[^\d.])/u,
  );
  return match
    ? validEgyptCoordinates(Number(match[1]), Number(match[2]))
    : null;
}

function safelyDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractGoogleMapsCoordinates(value: string): {
  latitude: number;
  longitude: number;
} | null {
  const url = parseSupportedGoogleMapsUrl(value);
  if (!url) return null;

  for (const parameter of ['q', 'query', 'll']) {
    const coordinates = coordinatesFromText(
      url.searchParams.get(parameter) ?? '',
    );
    if (coordinates) return coordinates;
  }

  const decodedUrl = safelyDecode(url.href);
  const pathMatch = decodedUrl.match(
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/u,
  );
  if (pathMatch) {
    const coordinates = validEgyptCoordinates(
      Number(pathMatch[1]),
      Number(pathMatch[2]),
    );
    if (coordinates) return coordinates;
  }

  const dataMatch = decodedUrl.match(
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/u,
  );
  if (dataMatch) {
    const coordinates = validEgyptCoordinates(
      Number(dataMatch[1]),
      Number(dataMatch[2]),
    );
    if (coordinates) return coordinates;
  }
  return null;
}

export function googleMapsReferenceKind(
  value: string,
): GoogleMapsReferenceKind | null {
  const url = parseSupportedGoogleMapsUrl(value);
  if (!url) return null;
  if (extractGoogleMapsCoordinates(url.href)) return 'COORDINATES';

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'maps.app.goo.gl' && url.pathname.length > 1) {
    return 'SHORT_LINK';
  }

  const decodedPath = safelyDecode(url.pathname);
  if (/\/maps\/place\/[^/]+/u.test(decodedPath)) return 'PLACE';
  if (/\/maps\/search\/[^/]+/u.test(decodedPath)) return 'SEARCH';

  const placeIdentifier =
    url.searchParams.get('query_place_id') ??
    url.searchParams.get('place_id') ??
    url.searchParams.get('cid');
  if (placeIdentifier?.trim()) return 'PLACE_IDENTIFIER';

  const textualQuery =
    url.searchParams.get('query') ?? url.searchParams.get('q');
  if (textualQuery?.trim()) return 'SEARCH';
  return null;
}

export function isSupportedGoogleMapsReference(value: string): boolean {
  return googleMapsReferenceKind(value) !== null;
}
