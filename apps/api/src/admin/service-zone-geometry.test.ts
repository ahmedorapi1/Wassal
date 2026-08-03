import { describe, expect, it } from 'vitest';

import {
  automaticCircleBounds,
  circleFromLegacyGeometry,
  geographicDistanceKm,
} from './service-zone-geometry.js';

describe('service-zone circle geometry', () => {
  it('uses an accurate geographic distance for circle eligibility', () => {
    const distance = geographicDistanceKm(
      { latitude: 31.4321, longitude: 31.8273 },
      { latitude: 31.6569, longitude: 31.8273 },
    );
    expect(distance).toBeGreaterThan(24.9);
    expect(distance).toBeLessThan(25.1);
  });

  it('calculates automatic compatibility bounds from center and radius', () => {
    const bounds = automaticCircleBounds({
      centerLatitude: 31.4321,
      centerLongitude: 31.8273,
      radiusKm: 25,
    });
    expect(bounds.north).toBeGreaterThan(31.65);
    expect(bounds.south).toBeLessThan(31.21);
    expect(bounds.east).toBeGreaterThan(32.08);
    expect(bounds.west).toBeLessThan(31.57);
  });

  it('derives a stored center and radius for legacy polygon API input', () => {
    const circle = circleFromLegacyGeometry({
      type: 'Polygon',
      coordinates: [
        [
          [31.7, 31.3],
          [31.95, 31.3],
          [31.95, 31.52],
          [31.7, 31.52],
          [31.7, 31.3],
        ],
      ],
    });
    expect(circle.centerLatitude).toBeCloseTo(31.41);
    expect(circle.centerLongitude).toBeCloseTo(31.825);
    expect(circle.radiusKm).toBeGreaterThan(16);
  });
});
