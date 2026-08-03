import { describe, expect, it } from 'vitest';

import { inlineContentDisposition } from './file-response.js';

describe('private file response headers', () => {
  it('provides safe ASCII fallback and RFC 5987 Unicode filename', () => {
    expect(inlineContentDisposition('رخصة القيادة.pdf')).toBe(
      'inline; filename="____ _______.pdf"; filename*=UTF-8\'\'%D8%B1%D8%AE%D8%B5%D8%A9%20%D8%A7%D9%84%D9%82%D9%8A%D8%A7%D8%AF%D8%A9.pdf',
    );
  });

  it('cannot inject another response header through the filename', () => {
    const header = inlineContentDisposition('file.pdf"\r\nX-Leak: yes');
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header).toContain('%0D%0A');
  });
});
