import { describe, expect, it, vi } from 'vitest';

import {
  appendReactNativeMultipart,
  stageAndroidDocument,
} from './android-document-upload.js';
import {
  documentUploadMaxBytes,
  type DocumentUploadError,
} from './document-upload.js';

describe('Android document staging', () => {
  it('copies a content:// URI into private file cache', async () => {
    const uri = 'content://com.android.providers.media/document/123';
    const copyAsync = vi.fn(async () => undefined);
    const getInfoAsync = vi.fn(async () => ({
      exists: true,
      isDirectory: false,
      size: 420,
    }));

    const staged = await stageAndroidDocument(
      {
        uri,
        name: 'صورة الهوية.jpg',
        mimeType: 'image/jpeg',
        size: 420,
      },
      {
        cacheDirectory: 'file:///data/user/0/host.exp.exponent/cache/',
        copyAsync,
        getInfoAsync,
      },
      'fixed-id',
    );

    expect(copyAsync).toHaveBeenCalledWith({
      from: uri,
      to: 'file:///data/user/0/host.exp.exponent/cache/skka-upload-fixed-id.jpg',
    });
    expect(staged).toEqual({
      cacheCopyCreated: true,
      uri: 'file:///data/user/0/host.exp.exponent/cache/skka-upload-fixed-id.jpg',
      name: 'صورة الهوية.jpg',
      mimeType: 'image/jpeg',
      size: 420,
      sourceScheme: 'content',
    });
  });

  it('uses an already-readable file:// picker cache asset without recopying it', async () => {
    const uri = 'file:///data/user/0/host.exp.exponent/cache/photo.jpg';
    const copyAsync = vi.fn(async () => undefined);
    const staged = await stageAndroidDocument(
      { uri, name: 'photo.jpg', mimeType: 'image/jpeg', size: 420 },
      {
        cacheDirectory: 'file:///data/user/0/host.exp.exponent/cache/',
        copyAsync,
        getInfoAsync: vi.fn(async () => ({
          exists: true,
          isDirectory: false,
          size: 420,
        })),
      },
      'fixed-id',
    );

    expect(copyAsync).not.toHaveBeenCalled();
    expect(staged).toEqual({
      cacheCopyCreated: false,
      uri,
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 420,
      sourceScheme: 'file',
    });
  });

  it('rejects a provider copy that did not create a readable cache file', async () => {
    await expect(
      stageAndroidDocument(
        {
          uri: 'content://provider/document/7',
          name: 'document.pdf',
          mimeType: 'application/pdf',
        },
        {
          cacheDirectory: 'file:///cache/',
          copyAsync: vi.fn(async () => undefined),
          getInfoAsync: vi.fn(async () => ({
            exists: false,
            size: 0,
          })),
        },
        'id',
      ),
    ).rejects.toMatchObject({
      code: 'unreadable',
    } satisfies Partial<DocumentUploadError>);
  });

  it('validates actual cached bytes instead of trusting picker size', async () => {
    await expect(
      stageAndroidDocument(
        {
          uri: 'content://provider/document/8',
          name: 'document.pdf',
          mimeType: 'application/pdf',
          size: 100,
        },
        {
          cacheDirectory: 'file:///cache/',
          copyAsync: vi.fn(async () => undefined),
          getInfoAsync: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            size: documentUploadMaxBytes + 1,
          })),
        },
        'id',
      ),
    ).rejects.toMatchObject({
      code: 'oversized',
    } satisfies Partial<DocumentUploadError>);
  });
});

describe('React Native multipart document body', () => {
  it('appends strings and the native {uri,name,type} file part', () => {
    const parts: Array<[string, unknown]> = [];
    const form = {
      append: (name: string, value: unknown) => parts.push([name, value]),
    };

    const filePart = appendReactNativeMultipart(
      form,
      {
        type: 'DRIVER_LICENSE',
        expiresAt: '2030-12-31',
      },
      {
        cacheCopyCreated: true,
        uri: 'file:///cache/wassal-upload-id.pdf',
        name: 'رخصة القيادة.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        sourceScheme: 'content',
      },
    );

    expect(filePart).toEqual({
      uri: 'file:///cache/wassal-upload-id.pdf',
      name: 'رخصة القيادة.pdf',
      type: 'application/pdf',
    });
    expect(parts).toEqual([
      ['type', 'DRIVER_LICENSE'],
      ['expiresAt', '2030-12-31'],
      ['file', filePart],
    ]);
  });
});
