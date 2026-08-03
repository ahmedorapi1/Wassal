export type ZoneCenter = {
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
};

type LegacyGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
};

const earthRadiusKm = 6_371.0088;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function geographicDistanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    earthRadiusKm *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function collectCoordinates(value: unknown, points: Array<[number, number]>) {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    points.push([value[0], value[1]]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCoordinates(item, points));
  }
}

export function circleFromLegacyGeometry(geometry: LegacyGeometry): ZoneCenter {
  const points: Array<[number, number]> = [];
  collectCoordinates(geometry.coordinates, points);
  if (points.length < 4) {
    throw new Error('The legacy service-zone geometry has too few points.');
  }
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const centerLongitude =
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
  const centerLatitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const radiusKm = Math.max(
    ...points.map(([longitude, latitude]) =>
      geographicDistanceKm(
        { latitude: centerLatitude, longitude: centerLongitude },
        { latitude, longitude },
      ),
    ),
  );
  return { centerLatitude, centerLongitude, radiusKm };
}

export function automaticCircleBounds(input: ZoneCenter) {
  const latitudeDelta = input.radiusKm / 111.32;
  const longitudeScale = Math.max(
    0.01,
    Math.cos(toRadians(input.centerLatitude)),
  );
  const longitudeDelta = input.radiusKm / (111.32 * longitudeScale);
  return {
    north: Math.min(90, input.centerLatitude + latitudeDelta),
    south: Math.max(-90, input.centerLatitude - latitudeDelta),
    east: Math.min(180, input.centerLongitude + longitudeDelta),
    west: Math.max(-180, input.centerLongitude - longitudeDelta),
  };
}
