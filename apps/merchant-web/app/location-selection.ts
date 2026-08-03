import type { MapPoint } from './open-map';

export type LocationEligibility = 'INSIDE' | 'OUTSIDE' | 'UNVALIDATED';

export const manualMapsLinkMessage =
  'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.';

export const insideServiceZoneMessage =
  'الموقع داخل نطاق التوصيل الحالي ويمكن حساب السعر.';

export const outsideServiceZoneMessage =
  'الموقع خارج نطاق التوصيل الحالي. يمكنك تغيير الموقع أو طلب توسيع نطاق الخدمة من الإدارة.';

export function canRequestQuote(
  locationConfirmed: boolean,
  eligibility: LocationEligibility,
) {
  return locationConfirmed && eligibility === 'INSIDE';
}

export function locationRequestErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/iu.test(
      message,
    )
  ) {
    return 'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.';
  }
  if (/too many|rate limit/iu.test(message)) {
    return 'تم تجاوز عدد محاولات فتح الروابط مؤقتاً. انتظر دقيقة ثم حاول مرة أخرى.';
  }
  if (/[\u0600-\u06ff]/u.test(message)) return message;
  return 'تعذر إتمام التحقق من الموقع. حاول مرة أخرى أو حدد النقطة يدوياً.';
}

export function pointForQuote(point: MapPoint): MapPoint {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}
