import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { MerchantApp } from './merchant-app';

describe('merchant Phase 1 entry journey', () => {
  it('renders an Arabic-first phone authentication form', () => {
    const html = renderToStaticMarkup(createElement(MerchantApp));
    expect(html).toContain('واصل للأعمال');
    expect(html).toContain('رقم الموبايل');
    expect(html).toContain('إرسال رمز التحقق');
    expect(html).not.toContain('إنشاء طلب توصيل');
  });
});
