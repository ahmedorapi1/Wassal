import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalObjectStorageProvider } from './local-object-storage.provider.js';

describe('LocalObjectStorageProvider', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('stores private bytes under an opaque key', async () => {
    directory = await mkdtemp(join(tmpdir(), 'wasel-storage-'));
    const provider = new LocalObjectStorageProvider(directory);
    await provider.putObject({
      objectKey: 'courier-id/object-id',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4'),
    });
    const result = await provider.getObject('courier-id/object-id');
    expect(result.contentType).toBe('application/pdf');
    expect(Buffer.from(result.bytes).toString()).toBe('%PDF-1.4');
  });

  it('rejects path traversal', async () => {
    directory = await mkdtemp(join(tmpdir(), 'wasel-storage-'));
    const provider = new LocalObjectStorageProvider(directory);
    await expect(provider.getObject('../secret')).rejects.toThrow(
      'Invalid object key',
    );
  });
});
