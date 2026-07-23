import { describe, expect, it } from 'vitest';

import { directionFor, translate } from './index.js';

describe('localization foundation', () => {
  it('treats Arabic as the RTL default experience', () => {
    expect(directionFor('ar-EG')).toBe('rtl');
    expect(translate('ar-EG', 'brand')).toBe('واصل');
  });

  it('keeps an English expansion path', () => {
    expect(directionFor('en')).toBe('ltr');
  });
});
