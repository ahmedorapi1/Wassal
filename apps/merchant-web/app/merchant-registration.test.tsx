import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  MerchantRegistrationForm,
  merchantRegistrationErrorMessage,
  validPilotPassword,
} from './merchant-registration';

describe('pilot merchant registration', () => {
  it('renders account, business, first-branch, and location requirements', () => {
    const html = renderToStaticMarkup(
      createElement(MerchantRegistrationForm, {
        fallbackPoint: { latitude: 31.41754, longitude: 31.81444 },
        onCancel: vi.fn(),
        onResolveMapsLink: vi.fn(),
        onSubmit: vi.fn(),
        onValidateLocation: vi.fn(),
      }),
    );
    for (const label of [
      'إنشاء حساب تاجر جديد',
      'الاسم الكامل للمالك',
      'رقم الموبايل المصري',
      'تأكيد كلمة المرور',
      'اسم النشاط أو التاجر',
      'فئة النشاط',
      'رقم التواصل',
      'الفرع الأول',
      'العنوان النصي الكامل والتفاصيل',
      'تحديد موقع الفرع على الخريطة',
      'استخدام موقعي الحالي',
      'لصق رابط Google Maps',
      'إرسال طلب التسجيل للمراجعة',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/إرسال طلب التسجيل للمراجعة[^>]*disabled|disabled/);
  });

  it('enforces the pilot password policy', () => {
    expect(validPilotPassword('weak')).toBe(false);
    expect(validPilotPassword('lowercase123')).toBe(false);
    expect(validPilotPassword('NoNumbersHere')).toBe(false);
    expect(validPilotPassword('PilotSecure123')).toBe(true);
  });

  it('returns safe Arabic registration errors', () => {
    expect(
      merchantRegistrationErrorMessage(new TypeError('Failed to fetch')),
    ).toBe('تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.');
    expect(
      merchantRegistrationErrorMessage(new Error('database constraint')),
    ).toBe('تعذر إرسال طلب التسجيل. راجع البيانات وحاول مرة أخرى.');
    expect(
      merchantRegistrationErrorMessage(new Error('رقم الهاتف مسجل بالفعل.')),
    ).toBe('رقم الهاتف مسجل بالفعل.');
  });
});
