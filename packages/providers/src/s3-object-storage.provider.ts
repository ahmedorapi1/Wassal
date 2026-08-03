import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ObjectStorageProvider } from './interfaces.js';

type S3ObjectStorageOptions = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  forcePathStyle?: boolean;
};

export class S3ObjectStorageProvider implements ObjectStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  public constructor(options: S3ObjectStorageOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix.replace(/^\/+|\/+$/g, '');
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  public createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(input.objectKey),
        ContentType: input.contentType,
        ServerSideEncryption: 'AES256',
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  public async putObject(input: {
    objectKey: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(input.objectKey),
        ContentType: input.contentType,
        Body: input.bytes,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  public async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(objectKey),
      }),
    );
  }

  public async getObject(objectKey: string) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(objectKey),
      }),
    );
    if (!result.Body) {
      throw new Error('Object storage returned an empty response body.');
    }
    return {
      contentType: result.ContentType ?? 'application/octet-stream',
      bytes: await result.Body.transformToByteArray(),
    };
  }

  private key(objectKey: string): string {
    const clean = objectKey.replace(/^\/+/, '');
    if (clean.includes('..')) {
      throw new Error('Object key traversal is not allowed.');
    }
    return this.prefix ? `${this.prefix}/${clean}` : clean;
  }
}
