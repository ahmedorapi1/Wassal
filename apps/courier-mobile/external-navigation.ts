export type NavigationPoint = {
  latitude: number;
  longitude: number;
};

export function externalNavigationUrl(point: NavigationPoint): string {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new Error('إحداثيات العنوان غير صالحة.');
  }
  const destination = `${point.latitude},${point.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
