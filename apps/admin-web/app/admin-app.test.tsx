import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { AdminApp, OrderDetail, PricingView } from './admin-app';

describe('admin Phase 3 entry journey', () => {
  it('renders the protected Arabic operations sign-in', () => {
    const html = renderToStaticMarkup(createElement(AdminApp));
    expect(html).toContain('تسجيل دخول الإدارة');
    expect(html).toContain('كل قرار تشغيلي موثق');
    expect(html).toContain('SKKA');
    expect(html).toContain('شعار سِكّة');
    expect(html).toContain('كل طلب له سكة');
    expect(html).not.toContain('WASSAL');
    expect(html).not.toContain('التسويات');
    expect(html).not.toContain('تعيين مندوب');
  });

  it('renders order snapshots and pricing as labeled fields without raw JSON', () => {
    const html = renderToStaticMarkup(
      createElement(OrderDetail, {
        adminRole: 'operations_admin',
        onBack: () => undefined,
        onCancel: () => undefined,
        order: {
          id: 'order-1',
          orderNumber: 'WSL-TEST-001',
          status: 'SEARCHING_COURIER',
          version: 1,
          merchantTotalMinor: 2247,
          currency: 'EGP',
          createdAt: '2026-07-27T12:00:00.000Z',
          pricingVersion: 3,
          merchant: { id: 'merchant-1', displayName: 'تاجر الاختبار' },
          store: { id: 'store-1', name: 'فرع دمياط' },
          serviceZone: { id: 'zone-1', name: 'دمياط' },
          customerSnapshot: {
            name: 'عميل الاختبار',
            normalizedPhone: '+201000000000',
          },
          pickupAddressSnapshot: {
            addressLine: '١٢ شارع الميناء',
            latitude: 31.41754,
            longitude: 31.81444,
          },
          dropoffAddressSnapshot: {
            addressLine: '٢٥ شارع الاختبار',
            locationSource: 'MAP_PICKER',
            latitude: 31.4321,
            longitude: 31.8273,
          },
          packageSnapshot: {
            category: 'documents',
            packageSize: 'SMALL',
            fragile: false,
          },
          routeSnapshot: { distanceMeters: 2494, durationSeconds: 374 },
          pricingSnapshot: {
            baseFeeMinor: 1500,
            distanceChargeMinor: 747,
            platformCommissionMinor: 449,
            estimatedCourierEarningMinor: 1798,
            merchantTotalMinor: 2247,
          },
          events: [],
          audit: [],
        },
      }),
    );
    expect(html).toContain('بيانات الطلب المحفوظة');
    expect(html).toContain('موقع التسليم');
    expect(html).toContain('تفصيل السعر');
    expect(html).toContain('فتح الموقع على الخريطة');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('platformCommissionMinor');
    expect(html).not.toContain('استحقاق المندوب');
  });

  it('renders repeatable pricing fields and keeps the logo centered without directional offsets', () => {
    const pricingHtml = renderToStaticMarkup(
      createElement(PricingView, {
        rules: [],
        zones: [],
        onCreate: () => undefined,
        onVersion: () => undefined,
        onToggle: () => undefined,
        onValidate: () => undefined,
      }),
    );
    expect(pricingHtml).toContain('شرائح الوزن');
    expect(pricingHtml).toContain('إضافات حجم الطرد');
    expect(pricingHtml).not.toContain('GeoJSON');

    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.login-logo[\s\S]*margin: 0 auto 2rem/);
    expect(css).toMatch(/\.login-logo[\s\S]*object-position: center/);
    expect(css).not.toMatch(/\.login-logo[\s\S]{0,180}margin-(left|right)/);
  });

  it('includes merchant registration details and all review decisions', () => {
    const source = readFileSync(
      new URL('./admin-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('طلب تسجيل تاجر');
    expect(source).toContain('فئة النشاط');
    expect(source).toContain('هاتف دخول المالك');
    expect(source).toContain('فتح موقع الفرع في Google Maps');
    expect(source).toContain("onTransition('request_changes')");
    expect(source).toContain('رفض مع السبب');
    expect(source).toContain('اعتماد التاجر');
  });

  it('uses center-and-radius service-zone editing without manual bounds', () => {
    const source = readFileSync(
      new URL('./admin-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('تحديد مركز المنطقة على الخريطة');
    expect(source).toContain('عرض على الخريطة');
    expect(source).toContain('حفظ تعديلات المنطقة');
    expect(source).toContain('تأكيد الإيقاف');
    expect(source).toContain(
      'request(`/admin/service-zones/${zone.id}`, token',
    );
    expect(source).not.toContain('name="west"');
    expect(source).not.toContain('name="east"');
    expect(source).not.toContain('name="north"');
    expect(source).not.toContain('name="south"');
  });

  it('exposes timeout attempts and cancellation financial evidence', () => {
    const source = readFileSync(
      new URL('./admin-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('محاولات نشر الطلب');
    expect(source).toContain('COURIER_SEARCH_EXPIRED');
    expect(source).toContain('سبب الإلغاء');
    expect(source).toContain('بعد استلام المندوب');
    expect(source).toContain('قيمة التوصيل المستحقة بسبب الإلغاء');
    expect(source).toContain('courierLedgerEntries');
  });
});
