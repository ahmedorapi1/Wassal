import { describe, expect, it } from 'vitest';

import {
  extractGoogleMapsCoordinates,
  googleMapsReferenceKind,
  isSupportedGoogleMapsReference,
} from './google-maps';

describe('Google Maps location references', () => {
  it.each([
    [
      'https://www.google.com/maps/@31.4321,31.8273,16z',
      { latitude: 31.4321, longitude: 31.8273 },
    ],
    [
      'https://maps.google.com/?q=31.4321%2C31.8273',
      { latitude: 31.4321, longitude: 31.8273 },
    ],
    [
      'https://www.google.com/maps/search/?api=1&query=31.441%2C31.81',
      { latitude: 31.441, longitude: 31.81 },
    ],
    [
      'https://www.google.com/maps/place/Damietta/data=!3m1!4b1!4m6!3m5!3d31.41754!4d31.81444',
      { latitude: 31.41754, longitude: 31.81444 },
    ],
  ])('extracts coordinates from %s', (url, coordinates) => {
    expect(extractGoogleMapsCoordinates(url)).toEqual(coordinates);
    expect(googleMapsReferenceKind(url)).toBe('COORDINATES');
  });

  it.each([
    ['https://www.google.com/maps/place/Damietta', 'PLACE'],
    ['https://www.google.com/maps/search/Damietta', 'SEARCH'],
    ['https://www.google.com/maps/search/?api=1&query=Damietta', 'SEARCH'],
    [
      'https://www.google.com/maps/place/?query_place_id=ChIJ_example',
      'PLACE_IDENTIFIER',
    ],
    ['https://maps.app.goo.gl/example', 'SHORT_LINK'],
  ])('accepts a coordinate-free location reference %s', (url, kind) => {
    expect(extractGoogleMapsCoordinates(url)).toBeNull();
    expect(googleMapsReferenceKind(url)).toBe(kind);
    expect(isSupportedGoogleMapsReference(url)).toBe(true);
  });

  it.each([
    'https://www.google.com/maps',
    'https://evil.example/maps?q=31.4,31.8',
    'http://maps.google.com/?q=31.4,31.8',
    'not-a-url',
  ])('rejects an unsupported or location-free URL %s', (url) => {
    expect(isSupportedGoogleMapsReference(url)).toBe(false);
  });
});
