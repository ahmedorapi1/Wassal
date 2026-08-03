import { describe, expect, it } from 'vitest';

import { safeMultipartFilename } from './courier.service.js';

describe('courier multipart filenames', () => {
  it('decodes the percent-encoded filename emitted by React Native FormData', () => {
    expect(
      safeMultipartFilename(
        '%D8%B1%D8%AE%D8%B5%D8%A9%20%D8%A7%D9%84%D9%82%D9%8A%D8%A7%D8%AF%D8%A9.pdf',
      ),
    ).toBe('رخصة القيادة.pdf');
  });

  it('normalizes legacy latin1-decoded UTF-8 filenames', () => {
    const mojibake = Buffer.from('صورة الهوية.png', 'utf8').toString('latin1');
    expect(safeMultipartFilename(mojibake)).toBe('صورة الهوية.png');
  });

  it('removes path and control characters after decoding', () => {
    expect(safeMultipartFilename('folder%2Fscan%0A.pdf')).toBe(
      'folder_scan_.pdf',
    );
  });
});
