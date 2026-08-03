import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MapPicker } from './map-picker';

describe('merchant map picker controls', () => {
  it('renders RTL navigation, selection, reset, clear, and confirmation controls', () => {
    const html = renderToStaticMarkup(
      createElement(MapPicker, {
        initialPoint: { latitude: 31.4321, longitude: 31.8273 },
        storePoint: { latitude: 31.41754, longitude: 31.81444 },
        guidance: 'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.',
        onCancel: vi.fn(),
        onConfirm: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain('البحث عن عنوان — اختياري');
    expect(html).toContain('فتح البحث في Google Maps');
    expect(html).toContain('موقع المتجر');
    expect(html).toContain('موقعي الحالي');
    expect(html).toContain('موقع العميل المحدد');
    expect(html).toContain('إعادة ضبط العرض');
    expect(html).toContain('تأكيد الموقع');
    expect(html).toContain('مسح الموقع');
    expect(html).toContain('إلغاء');
    expect(html).not.toContain('البحث غير متاح حالياً');
    expect(html).toContain(
      'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.',
    );
  });

  it('remeasures the full responsive map after the dialog becomes visible', () => {
    const source = readFileSync(
      new URL('./map-picker.tsx', import.meta.url),
      'utf8',
    );
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(source).toContain('new ResizeObserver(update)');
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('window.setTimeout(update, 240)');
    expect(css).toMatch(
      /\.open-map\s*\{[\s\S]*min-width:\s*0[\s\S]*width:\s*100%/,
    );
    expect(css).toMatch(/\.open-map-picker\s*\{[\s\S]*isolation:\s*isolate/);
    expect(css).toMatch(
      /\.customer-location-section\s*\{[\s\S]*overflow:\s*visible/,
    );
  });
});
