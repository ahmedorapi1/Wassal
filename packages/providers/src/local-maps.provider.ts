import type { Coordinates } from '@wasel/validation';

import type { MapsProvider } from './interfaces.js';

const earthRadiusMeters = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export class DeterministicLocalMapsProvider implements MapsProvider {
  public async geocode(): Promise<Coordinates> {
    throw new Error(
      'Local geocoding is not available. Supply validated coordinates.',
    );
  }

  public validateCoordinates(coordinates: Coordinates): boolean {
    return (
      Number.isFinite(coordinates.latitude) &&
      Number.isFinite(coordinates.longitude) &&
      coordinates.latitude >= -90 &&
      coordinates.latitude <= 90 &&
      coordinates.longitude >= -180 &&
      coordinates.longitude <= 180
    );
  }

  public async route(origin: Coordinates, destination: Coordinates) {
    if (
      !this.validateCoordinates(origin) ||
      !this.validateCoordinates(destination)
    ) {
      throw new Error('Route coordinates are invalid.');
    }
    const latitudeDelta = toRadians(destination.latitude - origin.latitude);
    const longitudeDelta = toRadians(destination.longitude - origin.longitude);
    const originLatitude = toRadians(origin.latitude);
    const destinationLatitude = toRadians(destination.latitude);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(originLatitude) *
        Math.cos(destinationLatitude) *
        Math.sin(longitudeDelta / 2) ** 2;
    const straightLineMeters =
      2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));

    // A stable road-network factor and a 24 km/h urban motorcycle speed make
    // local quotes reproducible without pretending to be live traffic data.
    const distanceMeters = Math.max(1, Math.round(straightLineMeters * 1.23));
    const durationSeconds = Math.max(
      60,
      Math.round(distanceMeters / (24_000 / 3_600)),
    );
    return { distanceMeters, durationSeconds };
  }
}
