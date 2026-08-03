import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { MerchantApp } from './merchant-app';

describe('merchant Phase 4 entry journey', () => {
  it('loads the root environment for individually started web apps', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['dev:admin']).toContain('dotenv -e .env --');
    expect(packageJson.scripts['dev:merchant']).toContain('dotenv -e .env --');
  });

  it('renders Arabic-first password authentication and legal links', () => {
    const html = renderToStaticMarkup(createElement(MerchantApp));
    expect(html).toContain('SKKA · سِكّة للأعمال');
    expect(html).toContain('كل طلب له سكة');
    expect(html).toContain('رقم الموبايل');
    expect(html).toContain('كلمة المرور');
    expect(html).toContain('تسجيل الدخول');
    expect(html).toContain('إنشاء حساب تاجر جديد');
    expect(html).toContain('المرحلة الرابعة');
    expect(html).toContain('سياسة الخصوصية');
    expect(html).toContain('شعار سِكّة');
    expect(html).not.toContain('WASSAL');
    expect(html).not.toContain('إرسال رمز التحقق');
  });

  it('applies centered contain sizing to the repository logo in RTL', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.auth-logo-frame[\s\S]*justify-content: center/);
    expect(css).toMatch(/\.auth-logo[\s\S]*object-fit: contain/);
    expect(css).toMatch(/\.auth-logo[\s\S]*object-position: center/);
    expect(css).not.toMatch(/\.auth-logo[\s\S]{0,180}margin-(left|right)/);
  });

  it('posts a new branch through the merchant endpoint and refreshes stores', () => {
    const source = readFileSync(
      new URL('./merchant-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      "request<Store>('/merchants/current/stores', token",
    );
    expect(source).toContain(
      "request<Store[]>('/merchants/current/stores', token)",
    );
    expect(source).toContain('canManageBranches(merchant.membership.role)');
    expect(source).toContain('إضافة فرع جديد');
    expect(source).toContain("'/location/validate-pickup'");
    expect(source).toContain("'/auth/merchant-registration'");
    expect(source).toContain(
      'setSecondsLeft(Math.max(0, Math.ceil(result.expiresInSeconds)))',
    );
  });

  it('renders the five-minute retry and before/after-pickup cancellation policy', () => {
    const source = readFileSync(
      new URL('./merchant-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('/retry-courier-search');
    expect(source).toContain('إعادة البحث عن مندوب');
    expect(source).toContain('محاولة البحث {order.dispatchAttemptCount} من 2');
    expect(source).toContain('الإلغاء مجاني بالكامل قبل استلام المندوب');
    expect(source).toContain(
      'المندوب استلم الطلب بالفعل. عند الإلغاء سيتم إرجاع الطلب إلى الفرع وستظل قيمة التوصيل مستحقة بالكامل.',
    );
    expect(source).toContain("'NO_COURIER_AVAILABLE_FINAL'");
  });
});
