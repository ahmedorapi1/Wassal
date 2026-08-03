import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  BranchCreationForm,
  branchCreationErrorMessage,
  canManageBranches,
  resolvedBranchMapPoint,
} from './branch-creation-form';

describe('merchant branch creation workflow', () => {
  it('allows only merchant owners and managers to manage branches', () => {
    expect(canManageBranches('OWNER')).toBe(true);
    expect(canManageBranches('MANAGER')).toBe(true);
    expect(canManageBranches('STAFF')).toBe(false);
  });

  it('renders all required Arabic branch and location fields', () => {
    const html = renderToStaticMarkup(
      createElement(BranchCreationForm, {
        fallbackPoint: { latitude: 31.41754, longitude: 31.81444 },
        onCancel: vi.fn(),
        onCreate: vi.fn(async () => undefined),
        onResolveMapsLink: vi.fn(),
        onValidateLocation: vi.fn(),
      }),
    );
    expect(html).toContain('إضافة فرع جديد');
    expect(html).toContain('اسم الفرع');
    expect(html).toContain('رقم هاتف الفرع');
    expect(html).toContain('المحافظة');
    expect(html).toContain('العنوان التفصيلي');
    expect(html).toContain('المنطقة');
    expect(html).toContain('المدينة');
    expect(html).toContain('الشارع');
    expect(html).toContain('تحديد موقع الفرع على الخريطة');
    expect(html).toContain('استخدام موقعي الحالي');
    expect(html).toContain('لصق رابط Google Maps');
    expect(html).toContain('خط العرض');
    expect(html).toContain('خط الطول');
    expect(html).toContain('حفظ الفرع الجديد');
  });

  it('centers on extracted link coordinates and falls back safely without them', () => {
    const fallback = { latitude: 31.41754, longitude: 31.81444 };
    const current = { latitude: 31.44, longitude: 31.78 };
    expect(
      resolvedBranchMapPoint(
        { latitude: 31.4321, longitude: 31.8273 },
        current,
        fallback,
      ),
    ).toEqual({ latitude: 31.4321, longitude: 31.8273 });
    expect(
      resolvedBranchMapPoint(
        { latitude: null, longitude: null },
        current,
        fallback,
      ),
    ).toEqual(current);
    expect(
      resolvedBranchMapPoint(
        { latitude: null, longitude: null },
        null,
        fallback,
      ),
    ).toEqual(fallback);
  });

  it('does not expose raw create or network errors', () => {
    expect(branchCreationErrorMessage(new Error('validation_failed'))).toBe(
      'تعذر إنشاء الفرع. راجع البيانات وحاول مرة أخرى.',
    );
    expect(branchCreationErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.',
    );
  });
});
