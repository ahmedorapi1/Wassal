import { describe, expect, it } from 'vitest';

import {
  canRequestQuote,
  locationRequestErrorMessage,
  manualMapsLinkMessage,
  outsideServiceZoneMessage,
  pointForQuote,
} from './location-selection';

describe('merchant location eligibility and error UX', () => {
  it('keeps an outside-zone point selected while disabling quote creation', () => {
    const outsidePoint = { latitude: 31.56, longitude: 31.98 };
    expect(pointForQuote(outsidePoint)).toEqual(outsidePoint);
    expect(canRequestQuote(true, 'OUTSIDE')).toBe(false);
    expect(outsideServiceZoneMessage).toContain('خارج نطاق التوصيل الحالي');
  });

  it('enables quote creation only after an inside-zone confirmation', () => {
    expect(canRequestQuote(false, 'INSIDE')).toBe(false);
    expect(canRequestQuote(true, 'UNVALIDATED')).toBe(false);
    expect(canRequestQuote(true, 'INSIDE')).toBe(true);
  });

  it('passes a distant selected point to the quote payload unchanged', () => {
    const distantPoint = { latitude: 31.49, longitude: 31.72 };
    expect(pointForQuote(distantPoint)).toStrictEqual(distantPoint);
  });

  it('uses clear Arabic fallback and network messages instead of raw errors', () => {
    expect(manualMapsLinkMessage).toBe(
      'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.',
    );
    expect(locationRequestErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.',
    );
    expect(locationRequestErrorMessage(new Error('ECONNRESET at socket'))).toBe(
      'تعذر إتمام التحقق من الموقع. حاول مرة أخرى أو حدد النقطة يدوياً.',
    );
  });
});
