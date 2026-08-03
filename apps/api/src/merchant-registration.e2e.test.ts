import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@wasel/database';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('pilot merchant registration and review', () => {
  let app: INestApplication;
  const uniqueDigits = Date.now().toString().slice(-8);
  const phone = `+2015${uniqueDigits}`;
  const password = 'PilotMerchant123';
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  let merchantId = '';

  beforeAll(async () => {
    if (!databaseUrl || !redisUrl) {
      throw new Error(
        'DATABASE_URL and REDIS_URL are required for integration tests.',
      );
    }
    await clearRegistrationRateLimits(redisUrl, phone);
    process.env.MERCHANT_PILOT_REGISTRATION_ENABLED = 'true';
    const { AppModule } = await import('./app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (databaseUrl) {
      const database = createDatabaseClient(databaseUrl);
      const user = await database.user.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (user) {
        await database.session.deleteMany({ where: { userId: user.id } });
        await database.merchantMembership.deleteMany({
          where: { userId: user.id },
        });
        if (merchantId) {
          await database.store.deleteMany({ where: { merchantId } });
          await database.merchant.deleteMany({ where: { id: merchantId } });
        }
        await database.user.deleteMany({ where: { id: user.id } });
      }
      await database.$disconnect();
    }
    if (redisUrl) {
      await clearRegistrationRateLimits(redisUrl, phone);
    }
    await app?.close();
  }, 60_000);

  it('creates the pending owner, merchant, and first mapped branch atomically', async () => {
    const validation = await request(app.getHttpServer())
      .post('/api/v1/auth/merchant-registration/location/validate')
      .send({ latitude: 31.41754, longitude: 31.81444 })
      .expect(201);
    expect(validation.body).toMatchObject({
      supported: true,
      serviceZone: { governorate: 'دمياط', city: 'دمياط' },
    });

    const registration = await request(app.getHttpServer())
      .post('/api/v1/auth/merchant-registration')
      .send({
        ownerFullName: 'مالك تجريبي جديد',
        phone,
        password,
        passwordConfirmation: password,
        business: {
          name: `متجر تسجيل ${uniqueDigits}`,
          category: 'متجر تجزئة',
          contactPhone: phone,
          email: `merchant-${uniqueDigits}@example.test`,
        },
        firstBranch: {
          name: 'الفرع الرئيسي',
          phone,
          governorate: 'دمياط',
          city: 'دمياط',
          area: 'وسط دمياط',
          street: 'شارع الميناء',
          addressDetails: 'مبنى ١٢، الدور الأرضي',
          addressLine: 'شارع الميناء، مبنى ١٢، الدور الأرضي، وسط دمياط، دمياط',
          sourceMapsUrl: 'https://www.google.com/maps/@31.41754,31.81444,17z',
          latitude: 31.41754,
          longitude: 31.81444,
        },
      })
      .expect(201);
    expect(registration.body.status).toBe('pending_review');
    merchantId = registration.body.merchantId as string;

    const database = createDatabaseClient(databaseUrl!);
    const merchant = await database.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      include: { memberships: { include: { user: true } }, stores: true },
    });
    expect(merchant).toMatchObject({
      status: 'PENDING',
      businessCategory: 'متجر تجزئة',
      contactPhone: phone,
    });
    expect(merchant.memberships[0]?.user.status).toBe('PENDING');
    expect(merchant.stores[0]).toMatchObject({
      name: 'الفرع الرئيسي',
      governorate: 'دمياط',
      street: 'شارع الميناء',
    });
    const [mapped] = await database.$queryRaw<
      Array<{ latitude: number; longitude: number }>
    >`
      SELECT
        ST_Y("location"::geometry) AS "latitude",
        ST_X("location"::geometry) AS "longitude"
      FROM "Store"
      WHERE "merchantId" = ${merchantId}::uuid
    `;
    expect(mapped?.latitude).toBeCloseTo(31.41754);
    expect(mapped?.longitude).toBeCloseTo(31.81444);
    await database.$disconnect();

    await request(app.getHttpServer())
      .post('/api/v1/auth/merchant-registration')
      .send({
        ownerFullName: 'اسم مكرر',
        phone,
        password,
        passwordConfirmation: password,
        business: {
          name: 'متجر مكرر',
          category: 'متجر تجزئة',
          contactPhone: phone,
        },
        firstBranch: {
          name: 'فرع مكرر',
          phone,
          governorate: 'دمياط',
          city: 'دمياط',
          area: 'وسط دمياط',
          street: 'شارع الاختبار',
          addressDetails: 'عنوان مكرر للاختبار',
          addressLine: 'شارع الاختبار، وسط دمياط، دمياط',
          latitude: 31.41754,
          longitude: 31.81444,
        },
      })
      .expect(409);
  });

  it('blocks operations while pending and supports request-changes then approval', async () => {
    const pendingLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password })
      .expect(201);
    const pendingAuthorization = `Bearer ${pendingLogin.body.tokens.accessToken}`;
    const current = await request(app.getHttpServer())
      .get('/api/v1/merchants/current')
      .set('Authorization', pendingAuthorization)
      .expect(200);
    expect(current.body.status).toBe('PENDING');
    await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', pendingAuthorization)
      .expect(404);

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: '+201001000005', password: 'AdminDemo123' })
      .expect(201);
    const adminAuthorization = `Bearer ${adminLogin.body.tokens.accessToken}`;
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/merchants/${merchantId}`)
      .set('Authorization', adminAuthorization)
      .expect(200);
    expect(detail.body.stores[0]).toMatchObject({
      latitude: 31.41754,
      longitude: 31.81444,
    });

    const changes = await request(app.getHttpServer())
      .post(`/api/v1/admin/merchants/${merchantId}/request-changes`)
      .set('Authorization', adminAuthorization)
      .send({
        version: detail.body.version,
        reason: 'يرجى توضيح رقم المبنى في عنوان الفرع.',
      })
      .expect(201);
    expect(changes.body).toMatchObject({
      status: 'CHANGES_REQUESTED',
      reviewNotes: 'يرجى توضيح رقم المبنى في عنوان الفرع.',
    });

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/admin/merchants/${merchantId}/approve`)
      .set('Authorization', adminAuthorization)
      .send({ version: changes.body.version })
      .expect(201);
    expect(approved.body).toMatchObject({
      status: 'ACTIVE',
      reviewNotes: null,
    });

    const approvedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${approvedLogin.body.tokens.accessToken}`)
      .expect(200);
  });
});

async function clearRegistrationRateLimits(redisUrl: string, phone: string) {
  const redis = new Redis(redisUrl);
  const keys = [
    ...(await redis.keys('merchant-registration:ip:*')),
    ...(await redis.keys(`merchant-registration:*${phone}*`)),
  ];
  if (keys.length > 0) await redis.del(...new Set(keys));
  await redis.quit();
}
