import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import type { ObjectStorageProvider } from './interfaces.js';

export class LocalObjectStorageProvider implements ObjectStorageProvider {
  readonly #contentTypes = new Map<string, string>();
  readonly #root: string;

  public constructor(rootDirectory: string) {
    this.#root = resolve(rootDirectory);
  }

  public async createUploadUrl(): Promise<string> {
    throw new Error('Local storage accepts authenticated API uploads only.');
  }

  public async putObject(input: {
    objectKey: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void> {
    const target = this.safePath(input.objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.bytes, { flag: 'wx' });
    this.#contentTypes.set(input.objectKey, input.contentType);
  }

  public async getObject(objectKey: string): Promise<{
    contentType: string;
    bytes: Uint8Array;
  }> {
    return {
      contentType:
        this.#contentTypes.get(objectKey) ?? 'application/octet-stream',
      bytes: await readFile(this.safePath(objectKey)),
    };
  }

  private safePath(objectKey: string): string {
    const target = resolve(this.#root, objectKey);
    if (!target.startsWith(`${this.#root}${sep}`)) {
      throw new Error('Invalid object key.');
    }
    return target;
  }
}
