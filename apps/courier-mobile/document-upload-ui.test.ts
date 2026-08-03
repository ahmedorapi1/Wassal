import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('courier document upload UI flow', () => {
  const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

  it('asks DocumentPicker to preserve Android provider access with a cache copy', () => {
    expect(source).toContain('copyToCacheDirectory: true');
    expect(source).toContain('stageAndroidDocument');
    expect(source).toContain('new File(from).copy(new File(to)');
  });

  it('keeps selection for explicit send/retry and prevents duplicate sends', () => {
    expect(source).toContain('selectedDocuments[type]');
    expect(source).toContain('if (!prepared || uploadingDocumentType) return');
    expect(source).toContain("setMessage('جارٍ رفع الملف...')");
    expect(source).toContain("setMessage('تم رفع المستند بنجاح.')");
    expect(source).toContain('onRemove={removeSelectedDocument}');
    expect(source).toContain('selected.mimeType');
    expect(source).toContain('formatFileSize(selected.size)');
  });

  it('lets fetch generate the multipart boundary', () => {
    const uploadStart = source.indexOf('const sendUpload = async');
    const uploadEnd = source.indexOf('const activeTokens', uploadStart);
    const uploadRequest = source.slice(uploadStart, uploadEnd);
    expect(uploadRequest).toContain('Authorization: `Bearer ${accessToken}`');
    expect(uploadRequest).not.toContain('Content-Type');
  });
});
