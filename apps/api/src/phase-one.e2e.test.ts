import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@wasel/database';
import { LocalObjectStorageProvider } from '@wasel/providers';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';

describe('Phase 1 HTTP authentication and RBAC', () => {
  let app: INestApplication;
  const uniqueDigits = Date.now().toString().slice(-8);
  const phone = `+2015${uniqueDigits}`;
  const merchantPhoneA = `+2012${uniqueDigits}`;
  const merchantPhoneB = `+2011${uniqueDigits}`;
  const uploadPhone = `+2010${uniqueDigits}`;
  const operationsPhone = '+201001000004';
  const pendingCourierId = '40000000-0000-4000-8000-000000000012';
  const testPhones = [phone, merchantPhoneA, merchantPhoneB, uploadPhone];
  const allOtpPhones = [...testPhones, operationsPhone];
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  let cachedOperationsAuthorization: string | undefined;

  async function operationsAuthorization(): Promise<string> {
    if (cachedOperationsAuthorization) return cachedOperationsAuthorization;
    const challenge = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: operationsPhone })
      .expect(201);
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({
        challengeId: challenge.body.challengeId,
        code: process.env.OTP_MOCK_CODE ?? '123456',
      })
      .expect(201);
    cachedOperationsAuthorization = `Bearer ${verified.body.tokens.accessToken}`;
    return cachedOperationsAuthorization;
  }

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      throw new Error(
        'DATABASE_URL and REDIS_URL are required for integration tests.',
      );
    }
    const database = createDatabaseClient(databaseUrl);
    await database.otpChallenge.deleteMany({
      where: { phone: { in: allOtpPhones } },
    });
    await database.$disconnect();
    const redis = new Redis(redisUrl);
    const phoneKeys = (
      await Promise.all(
        allOtpPhones.map((testPhone) => redis.keys(`otp:*${testPhone}*`)),
      )
    ).flat();
    const ipKeys = await redis.keys('otp:ip:*');
    const cleanupKeys = [...phoneKeys, ...ipKeys];
    if (cleanupKeys.length > 0) await redis.del(...cleanupKeys);
    await redis.quit();
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    if (databaseUrl) {
      const database = createDatabaseClient(databaseUrl);
      const users = await database.user.findMany({
        where: { phone: { in: testPhones } },
        select: {
          id: true,
          merchantMemberships: { select: { merchantId: true } },
        },
      });
      const userIds = users.map(({ id }) => id);
      const merchantIds = [
        ...new Set(
          users.flatMap(({ merchantMemberships }) =>
            merchantMemberships.map(({ merchantId }) => merchantId),
          ),
        ),
      ];
      const courierProfiles = await database.courierProfile.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      });
      const courierIds = courierProfiles.map(({ id }) => id);
      const storedDocuments = await database.courierDocument.findMany({
        where: { courierId: { in: courierIds } },
        select: { storageKey: true },
      });
      if (process.env.STORAGE_LOCAL_DIR) {
        const storage = new LocalObjectStorageProvider(
          process.env.STORAGE_LOCAL_DIR,
        );
        for (const { storageKey } of storedDocuments) {
          await storage.deleteObject(storageKey);
        }
      }
      await database.otpChallenge.deleteMany({
        where: { phone: { in: allOtpPhones } },
      });
      await database.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.courierDocument.deleteMany({
        where: { courierId: { in: courierIds } },
      });
      await database.vehicle.deleteMany({
        where: { courierId: { in: courierIds } },
      });
      await database.courierProfile.deleteMany({
        where: { id: { in: courierIds } },
      });
      await database.merchantMembership.deleteMany({
        where: { userId: { in: userIds } },
      });
      await database.store.deleteMany({
        where: { merchantId: { in: merchantIds } },
      });
      await database.merchant.deleteMany({
        where: { id: { in: merchantIds } },
      });
      const operations = await database.user.findUnique({
        where: { phone: operationsPhone },
        select: { id: true },
      });
      if (operations) {
        await database.session.deleteMany({
          where: { userId: operations.id },
        });
      }
      await database.courierDocument.updateMany({
        where: { courierId: pendingCourierId },
        data: {
          status: 'PENDING',
          reviewedAt: null,
          reviewedById: null,
          reviewNotes: null,
        },
      });
      await database.courierProfile.updateMany({
        where: { id: pendingCourierId },
        data: {
          verificationStatus: 'PENDING_REVIEW',
          approvedAt: null,
          suspendedAt: null,
          statusReason: null,
        },
      });
      await database.$disconnect();
    }
    if (redisUrl) {
      const redis = new Redis(redisUrl);
      const keys = (
        await Promise.all(
          allOtpPhones.map((testPhone) => redis.keys(`otp:*${testPhone}*`)),
        )
      ).flat();
      const ipKeys = await redis.keys('otp:ip:*');
      const cleanupKeys = [...keys, ...ipKeys];
      if (cleanupKeys.length > 0) await redis.del(...cleanupKeys);
      await redis.quit();
    }
    await app.close();
  });

  it('authenticates, enforces RBAC, rotates refresh tokens, and detects reuse', async () => {
    const challenge = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone })
      .expect(201);

    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({
        challengeId: challenge.body.challengeId,
        code: process.env.OTP_MOCK_CODE ?? '123456',
        registrationRole: 'courier',
      })
      .expect(201);

    expect(verified.body.user.phone).toBe(phone);
    expect(verified.body.user.role).toBe('courier');

    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${verified.body.tokens.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/admin/couriers')
      .set('Authorization', `Bearer ${verified.body.tokens.accessToken}`)
      .expect(403);

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: verified.body.tokens.refreshToken })
      .expect(201);
    expect(refreshed.body.tokens.refreshToken).not.toBe(
      verified.body.tokens.refreshToken,
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: verified.body.tokens.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${refreshed.body.tokens.accessToken}`)
      .expect(401);
  });

  it('enforces merchant resource ownership against real PostGIS records', async () => {
    async function ownerToken(ownerPhone: string): Promise<string> {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone: ownerPhone })
        .expect(201);
      const verified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({
          challengeId: challenge.body.challengeId,
          code: process.env.OTP_MOCK_CODE ?? '123456',
          registrationRole: 'merchant_owner',
        })
        .expect(201);
      return verified.body.tokens.accessToken as string;
    }

    const ownerA = await ownerToken(merchantPhoneA);
    const ownerB = await ownerToken(merchantPhoneB);
    await request(app.getHttpServer())
      .post('/api/v1/merchants')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ legalName: 'Test A LLC', displayName: 'Test A' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/merchants')
      .set('Authorization', `Bearer ${ownerB}`)
      .send({ legalName: 'Test B LLC', displayName: 'Test B' })
      .expect(201);

    const store = await request(app.getHttpServer())
      .post('/api/v1/merchants/current/stores')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({
        name: 'Owned test store',
        phone: merchantPhoneA,
        addressLine: '12 Test Street, Damietta',
        governorate: 'دمياط',
        area: 'وسط دمياط',
        city: 'دمياط',
        street: 'Test Street',
        addressDetails: 'Building 12',
        latitude: 31.41754,
        longitude: 31.81444,
      })
      .expect(201);
    expect(store.body.latitude).toBeCloseTo(31.41754);
    expect(store.body.longitude).toBeCloseTo(31.81444);

    await request(app.getHttpServer())
      .get(`/api/v1/merchants/current/stores/${store.body.id}`)
      .set('Authorization', `Bearer ${ownerB}`)
      .expect(404);
  });

  it('uploads real multipart JPG, PNG, and PDF bytes idempotently and privately', async () => {
    const challenge = await request(app.getHttpServer())
      .post('/api/v1/auth/request-otp')
      .send({ phone: uploadPhone })
      .expect(201);
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({
        challengeId: challenge.body.challengeId,
        code: process.env.OTP_MOCK_CODE ?? '123456',
        registrationRole: 'courier',
      })
      .expect(201);
    const authorization = `Bearer ${verified.body.tokens.accessToken}`;

    await request(app.getHttpServer())
      .post('/api/v1/couriers/profile')
      .set('Authorization', authorization)
      .send({
        fullName: 'Multipart Test Courier',
        preferredCity: 'Giza',
        emergencyContactName: 'Test Contact',
        emergencyContactPhone: '+201000000001',
      })
      .expect(201);

    const samples = [
      {
        type: 'NATIONAL_ID_FRONT',
        filename: 'identity photo.jpg',
        contentType: 'image/jpeg',
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]),
      },
      {
        type: 'NATIONAL_ID_BACK',
        filename: 'البطاقة الخلفية.png',
        contentType: 'image/png',
        bytes: Buffer.concat([
          Buffer.from('89504e470d0a1a0a', 'hex'),
          Buffer.from([0x01]),
        ]),
      },
      {
        type: 'DRIVER_LICENSE',
        filename: 'driving license.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4\nintegration test'),
      },
    ] as const;
    const uploadedIds: string[] = [];

    for (const sample of samples) {
      const uploaded = await request(app.getHttpServer())
        .post('/api/v1/couriers/documents')
        .set('Authorization', authorization)
        .field('type', sample.type)
        .field('expiresAt', '2030-12-31')
        .attach('file', sample.bytes, {
          filename: sample.filename,
          contentType: sample.contentType,
        })
        .expect(201);
      expect(uploaded.body).toMatchObject({
        type: sample.type,
        originalFilename: sample.filename,
        contentType: sample.contentType,
        sizeBytes: sample.bytes.length,
      });
      expect(uploaded.body.storageKey).toBeUndefined();
      uploadedIds.push(uploaded.body.id as string);
    }

    const retried = await request(app.getHttpServer())
      .post('/api/v1/couriers/documents')
      .set('Authorization', authorization)
      .field('type', samples[0].type)
      .field('expiresAt', '2030-12-31')
      .attach('file', samples[0].bytes, {
        filename: samples[0].filename,
        contentType: samples[0].contentType,
      })
      .expect(201);
    expect(retried.body.id).toBe(uploadedIds[0]);

    const documents = await request(app.getHttpServer())
      .get('/api/v1/couriers/documents')
      .set('Authorization', authorization)
      .expect(200);
    expect(
      documents.body.filter((document: { isCurrent: boolean }) =>
        Boolean(document.isCurrent),
      ),
    ).toHaveLength(3);

    const database = createDatabaseClient(databaseUrl!);
    try {
      const storedRows = await database.courierDocument.findMany({
        where: { id: { in: uploadedIds } },
        orderBy: { createdAt: 'asc' },
      });
      expect(storedRows).toHaveLength(3);
      const storage = new LocalObjectStorageProvider(
        process.env.STORAGE_LOCAL_DIR!,
      );
      for (const row of storedRows) {
        const index = uploadedIds.indexOf(row.id);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(row).toMatchObject({
          contentType: samples[index]!.contentType,
          sizeBytes: samples[index]!.bytes.length,
          originalFilename: samples[index]!.filename,
          isCurrent: true,
        });
        expect(
          Buffer.from((await storage.getObject(row.storageKey)).bytes),
        ).toEqual(samples[index]!.bytes);
      }
    } finally {
      await database.$disconnect();
    }

    for (const [index, documentId] of uploadedIds.entries()) {
      const downloaded = await request(app.getHttpServer())
        .get(`/api/v1/couriers/documents/${documentId}/file`)
        .set('Authorization', authorization)
        .expect('Content-Type', samples[index]!.contentType)
        .expect('Cache-Control', 'private, no-store')
        .expect(200);
      expect(Buffer.from(downloaded.body)).toEqual(samples[index]!.bytes);
    }

    const operations = await operationsAuthorization();
    const adminDownload = await request(app.getHttpServer())
      .get(`/api/v1/couriers/documents/${uploadedIds[2]}/file`)
      .set('Authorization', operations)
      .expect('Content-Type', 'application/pdf')
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Content-Disposition', /filename\*=/)
      .expect(200);
    expect(Buffer.from(adminDownload.body)).toEqual(samples[2].bytes);

    await request(app.getHttpServer())
      .post('/api/v1/couriers/documents')
      .set('Authorization', authorization)
      .field('type', 'PROFILE_PHOTO')
      .attach('file', Buffer.from('<script>not an image</script>'), {
        filename: 'invalid.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/couriers/documents')
      .set('Authorization', authorization)
      .field('type', 'PROFILE_PHOTO')
      .attach('file', Buffer.alloc(5_242_881, 0), {
        filename: 'too-large.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);

    await request(app.getHttpServer())
      .get(`/api/v1/couriers/documents/${uploadedIds[0]}/file`)
      .expect(401);
  });

  it('protects courier review with reasons, versions, and auditable transitions', async () => {
    const authorization = await operationsAuthorization();

    const courier = await request(app.getHttpServer())
      .get(`/api/v1/admin/couriers/${pendingCourierId}`)
      .set('Authorization', authorization)
      .expect(200);
    const currentDocuments = courier.body.documents.filter(
      (document: { isCurrent: boolean }) => document.isCurrent,
    ) as Array<{ id: string; reviewVersion: number }>;
    expect(currentDocuments).toHaveLength(5);

    const first = currentDocuments[0]!;
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/couriers/${pendingCourierId}/documents/${first.id}/approve`,
      )
      .set('Authorization', authorization)
      .send({ version: first.reviewVersion })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/couriers/${pendingCourierId}/documents/${first.id}/approve`,
      )
      .set('Authorization', authorization)
      .send({ version: first.reviewVersion })
      .expect(409);

    for (const document of currentDocuments.slice(1)) {
      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/couriers/${pendingCourierId}/documents/${document.id}/approve`,
        )
        .set('Authorization', authorization)
        .send({ version: document.reviewVersion })
        .expect(201);
    }

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/admin/couriers/${pendingCourierId}/approve`)
      .set('Authorization', authorization)
      .send({ version: courier.body.version })
      .expect(201);
    expect(approved.body.verificationStatus).toBe('APPROVED');

    await request(app.getHttpServer())
      .post(`/api/v1/admin/couriers/${pendingCourierId}/suspend`)
      .set('Authorization', authorization)
      .send({ version: approved.body.version })
      .expect(400);
    const suspended = await request(app.getHttpServer())
      .post(`/api/v1/admin/couriers/${pendingCourierId}/suspend`)
      .set('Authorization', authorization)
      .send({
        version: approved.body.version,
        reason: 'Synthetic integration-test suspension.',
      })
      .expect(201);
    const reactivated = await request(app.getHttpServer())
      .post(`/api/v1/admin/couriers/${pendingCourierId}/reactivate`)
      .set('Authorization', authorization)
      .send({ version: suspended.body.version })
      .expect(201);
    expect(reactivated.body.verificationStatus).toBe('APPROVED');

    const history = await request(app.getHttpServer())
      .get(`/api/v1/admin/couriers/${pendingCourierId}/verification-history`)
      .set('Authorization', authorization)
      .expect(200);
    expect(
      history.body.some(
        (event: { action: string }) => event.action === 'suspend',
      ),
    ).toBe(true);
  });
});
