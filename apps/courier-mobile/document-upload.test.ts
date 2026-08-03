import { describe, expect, it } from 'vitest';

import {
  asDocumentUploadError,
  documentUploadErrorFromResponse,
  documentUploadMaxBytes,
  prepareDocumentAsset,
} from './document-upload.js';

describe('courier document upload metadata', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'image/jpeg'],
    ['photo.png', 'image/png', 'image/png'],
    ['document.pdf', 'application/pdf', 'application/pdf'],
    ['photo.jpeg', 'image/jpg', 'image/jpeg'],
  ])('accepts %s as %s', (name, mimeType, expectedMimeType) => {
    expect(
      prepareDocumentAsset({
        uri: `file:///cache/${name}`,
        name,
        mimeType,
        size: 120,
      }),
    ).toMatchObject({ name, mimeType: expectedMimeType, size: 120 });
  });

  it('preserves safe names containing spaces and Arabic characters', () => {
    expect(
      prepareDocumentAsset({
        uri: 'file:///cache/document.pdf',
        name: 'رخصة القيادة الجديدة ١.pdf',
        mimeType: 'application/pdf',
      }).name,
    ).toBe('رخصة القيادة الجديدة ١.pdf');
  });

  it.each([
    ['scan.jpg', 'image/jpeg'],
    ['scan.PNG', 'image/png'],
    ['scan.pdf', 'application/pdf'],
  ])('infers %s when the picker omits MIME type', (name, mimeType) => {
    expect(
      prepareDocumentAsset({
        uri: `file:///cache/${name}`,
        name,
        mimeType: null,
      }).mimeType,
    ).toBe(mimeType);
  });

  it.each(['application/octet-stream', 'binary/octet-stream'])(
    'infers a PDF from the filename when Android reports generic MIME %s',
    (mimeType) => {
      expect(
        prepareDocumentAsset({
          uri: 'content://provider/document/42',
          name: 'license.pdf',
          mimeType,
        }),
      ).toMatchObject({
        name: 'license.pdf',
        mimeType: 'application/pdf',
      });
    },
  );

  it('uses a safe filename fallback derived from MIME type', () => {
    expect(
      prepareDocumentAsset({
        uri: 'file:///cache/',
        name: '',
        mimeType: 'image/png',
      }).name,
    ).toBe('courier-document.png');
  });

  it.each([
    { name: 'payload.exe', mimeType: undefined },
    { name: 'payload.exe', mimeType: 'application/pdf' },
    { name: 'photo.jpg', mimeType: 'image/png' },
    { name: 'photo.jpg', mimeType: 'text/plain' },
  ])('rejects unsupported or inconsistent metadata: %o', (asset) => {
    expect(() =>
      prepareDocumentAsset({ uri: 'file:///cache/file', ...asset }),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_type' }));
  });

  it('rejects a selected file larger than 5 MB before upload', () => {
    expect(() =>
      prepareDocumentAsset({
        uri: 'file:///cache/photo.jpg',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: documentUploadMaxBytes + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'oversized' }));
  });

  it.each([undefined, null, '', '   '])(
    'rejects a missing or empty URI: %s',
    (uri) => {
      expect(() =>
        prepareDocumentAsset({
          uri,
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
        }),
      ).toThrowError(expect.objectContaining({ code: 'unreadable' }));
    },
  );

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [413, 'oversized'],
    [400, 'server_rejection'],
    [500, 'server_rejection'],
  ] as const)('maps HTTP %s to %s', (status, code) => {
    expect(
      documentUploadErrorFromResponse(
        status,
        JSON.stringify({ error: { message: 'API rejection' } }),
      ).code,
    ).toBe(code);
  });

  it('maps native upload interruption to a distinct network error', () => {
    expect(
      asDocumentUploadError(new Error('socket closed'), 'network').code,
    ).toBe('network');
  });
});
