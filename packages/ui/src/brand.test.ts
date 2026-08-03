/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { productName, productNameArabic, productSloganArabic } from './brand';

describe('SKKA brand contract', () => {
  it('exports the approved English name, Arabic name, and Arabic slogan', () => {
    expect(productName).toBe('SKKA');
    expect(productNameArabic).toBe('سِكّة');
    expect(productSloganArabic).toBe('كل طلب له سكة');
  });

  it('uses byte-for-byte copies of the supplied final logo in every application', () => {
    const suppliedLogo = readFileSync(
      new URL('../../../final logo.png', import.meta.url),
    );
    const runtimeLogos = [
      '../../../logo.png',
      '../assets/brand/skka-logo.png',
      '../../../apps/merchant-web/public/brand/skka-logo.png',
      '../../../apps/admin-web/public/brand/skka-logo.png',
      '../../../apps/courier-mobile/assets/brand/skka-logo.png',
    ];

    for (const logoPath of runtimeLogos) {
      const runtimeLogo = readFileSync(new URL(logoPath, import.meta.url));
      expect(runtimeLogo.equals(suppliedLogo), logoPath).toBe(true);
    }
  });
});
