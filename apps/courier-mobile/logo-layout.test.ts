/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('courier logo layout', () => {
  it('uses the repository logo with accessible, centered contain layout', () => {
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const operational = readFileSync(
      new URL('./operational-app.tsx', import.meta.url),
      'utf8',
    );
    expect(app).toContain("import skkaLogo from '../../logo.png'");
    expect(app).toContain('accessibilityLabel="شعار سِكّة"');
    expect(app).toContain('كل طلب له سكة');
    expect(app).not.toContain('WASSAL');
    expect(app).toContain('resizeMode="contain"');
    expect(app).toMatch(/header:\s*\{[\s\S]*alignItems: 'center'/);
    expect(app).toMatch(/logo:\s*\{[\s\S]*alignSelf: 'center'/);
    expect(operational).toContain("import skkaLogo from '../../logo.png'");
    expect(operational).toContain('كل طلب له سكة');
    expect(operational).not.toContain('WASSAL');
    expect(operational).toContain('resizeMode="contain"');
    expect(operational).not.toMatch(/operationalLogo:\s*\{[^}]*left:/);
  });
});
