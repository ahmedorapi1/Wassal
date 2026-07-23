import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { AdminApp } from './admin-app';

describe('admin Phase 1 entry journey', () => {
  it('renders the protected Arabic operations sign-in', () => {
    const html = renderToStaticMarkup(createElement(AdminApp));
    expect(html).toContain('تسجيل دخول الإدارة');
    expect(html).toContain('كل قرار مراجعة موثق');
    expect(html).not.toContain('التسويات');
  });
});
