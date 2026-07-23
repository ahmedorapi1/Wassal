import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@wasel/database';
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
  const operationsPhone = '+201001000004';
  const pendingCourierId = '40000000-0000-4000-8000-000000000012';
  const testPhones = [phone, merchantPhoneA, merchantPhoneB];
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      throw new Error(
        'DATABASE_URL and REDIS_URL are required for integration tests.',
      );
    }
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
      await database.otpChallenge.deleteMany({
        where: { phone: { in: [...testPhones, operationsPhone] } },
      });
      await database.session.deleteMany({ where: { userId: { in: userIds } } });
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
          testPhones.map((testPhone) => redis.keys(`otp:*${testPhone}*`)),
        )
      ).flat();
      if (keys.length > 0) await redis.del(...keys);
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
        addressLine: '12 Test Street',
        area: 'Dokki',
        city: 'Giza',
        latitude: 30.038542,
        longitude: 31.205856,
      })
      .expect(201);
    expect(store.body.latitude).toBeCloseTo(30.038542);
    expect(store.body.longitude).toBeCloseTo(31.205856);

    await request(app.getHttpServer())
      .get(`/api/v1/merchants/current/stores/${store.body.id}`)
      .set('Authorization', `Bearer ${ownerB}`)
      .expect(404);
  });

  it('protects courier review with reasons, versions, and auditable transitions', async () => {
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
    const authorization = `Bearer ${verified.body.tokens.accessToken}`;

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
