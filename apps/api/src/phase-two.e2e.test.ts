import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@wasel/database';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';

type AuthenticatedPersona = {
  authorization: string;
};

describe.sequential(
  'Phase 2 customer, quote, order, and admin journeys',
  () => {
    let app: INestApplication;
    let owner: AuthenticatedPersona;
    let staff: AuthenticatedPersona;
    let courier: AuthenticatedPersona;
    let superAdmin: AuthenticatedPersona;
    let otherOwner: AuthenticatedPersona;
    let storeId: string;
    let customerId: string;
    let addressId: string;
    let quoteId: string;
    let quoteVersion: number;
    let orderId: string;
    let orderVersion: number;

    const uniqueDigits = Date.now().toString().slice(-8);
    const customerPhone = `+2015${uniqueDigits}`;
    const otherMerchantPhone = `+2012${uniqueDigits}`;
    const personaPhones = [
      '+201001000001',
      '+201001000003',
      '+201001000005',
      '+201001000013',
      otherMerchantPhone,
    ];
    const idempotencySuffix = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    beforeAll(async () => {
      if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
        throw new Error(
          'DATABASE_URL and REDIS_URL are required for Phase 2 integration tests.',
        );
      }
      await clearOtpTestState();
      app = await NestFactory.create(AppModule, { logger: false });
      app.setGlobalPrefix('api/v1');
      await app.init();

      owner = await authenticate('+201001000001');
      staff = await authenticate('+201001000003');
      courier = await authenticate('+201001000013');
      superAdmin = await authenticate('+201001000005');
      otherOwner = await authenticate(otherMerchantPhone, 'merchant_owner');
      await request(app.getHttpServer())
        .post('/api/v1/merchants')
        .set('Authorization', otherOwner.authorization)
        .send({
          legalName: 'Synthetic Cross-Tenant Merchant LLC',
          displayName: 'Synthetic Cross-Tenant Merchant',
        })
        .expect(201);
    });

    afterAll(async () => {
      await app.close();
      await removeOtherMerchant();
      await clearOtpTestState();
    });

    async function clearOtpTestState(): Promise<void> {
      const database = createDatabaseClient(process.env.DATABASE_URL!);
      const redis = new Redis(process.env.REDIS_URL!);
      try {
        await database.otpChallenge.deleteMany({
          where: { phone: { in: personaPhones } },
        });
        const keys = [
          ...(await redis.keys('otp:ip:*')),
          ...personaPhones.map((phone) => `otp:phone:${phone}`),
        ];
        if (keys.length > 0) await redis.del(...keys);
      } finally {
        await database.$disconnect();
        await redis.quit();
      }
    }

    async function authenticate(
      phone: string,
      registrationRole?: 'merchant_owner',
    ): Promise<AuthenticatedPersona> {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone })
        .expect(201);
      const verified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({
          challengeId: challenge.body.challengeId,
          code: process.env.OTP_MOCK_CODE ?? '123456',
          ...(registrationRole ? { registrationRole } : {}),
        })
        .expect(201);
      return {
        authorization: `Bearer ${verified.body.tokens.accessToken as string}`,
      };
    }

    async function removeOtherMerchant(): Promise<void> {
      const database = createDatabaseClient(process.env.DATABASE_URL!);
      try {
        const user = await database.user.findUnique({
          where: { phone: otherMerchantPhone },
          select: {
            id: true,
            merchantMemberships: { select: { merchantId: true } },
          },
        });
        if (!user) return;
        const merchantIds = user.merchantMemberships.map(
          (membership) => membership.merchantId,
        );
        await database.session.deleteMany({ where: { userId: user.id } });
        await database.merchantMembership.deleteMany({
          where: { userId: user.id },
        });
        await database.merchant.deleteMany({
          where: { id: { in: merchantIds } },
        });
        // The append-only audit log intentionally retains the synthetic actor.
        // Removing the tenant membership/merchant is sufficient for isolation.
      } finally {
        await database.$disconnect();
      }
    }

    it('creates a merchant-scoped customer and saved PostGIS address', async () => {
      const stores = await request(app.getHttpServer())
        .get('/api/v1/merchants/current/stores')
        .set('Authorization', owner.authorization)
        .expect(200);
      storeId = stores.body[0].id as string;

      const customer = await request(app.getHttpServer())
        .post('/api/v1/merchant/customers')
        .set('Authorization', owner.authorization)
        .send({
          name: 'عميل تكامل تجريبي',
          phone: customerPhone,
          email: `phase2-${uniqueDigits}@example.test`,
          notes: 'Synthetic Phase 2 integration persona.',
        })
        .expect(201);
      customerId = customer.body.id as string;
      expect(customer.body.normalizedPhone).toBe(customerPhone);

      const address = await request(app.getHttpServer())
        .post(`/api/v1/merchant/customers/${customerId}/addresses`)
        .set('Authorization', owner.authorization)
        .send({
          label: 'عنوان اختبار',
          contactName: 'عميل تكامل تجريبي',
          contactPhone: customerPhone,
          addressLine: '٢٥ شارع صناعي تجريبي، دمياط',
          buildingNumber: '٢٥',
          floor: '٢',
          apartment: '٤',
          landmark: 'بجوار المعلم التجريبي',
          area: 'وسط دمياط',
          city: 'دمياط',
          governorate: 'دمياط',
          instructions: 'بيانات صناعية للاختبار فقط.',
          latitude: 31.4321,
          longitude: 31.8273,
        })
        .expect(201);
      addressId = address.body.id as string;
      expect(address.body.latitude).toBeCloseTo(31.4321);
      expect(address.body.longitude).toBeCloseTo(31.8273);

      await request(app.getHttpServer())
        .get(`/api/v1/merchant/customers/${customerId}`)
        .set('Authorization', staff.authorization)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/merchant/customers/${customerId}`)
        .set('Authorization', otherOwner.authorization)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/merchant/customers/${customerId}/archive`)
        .set('Authorization', staff.authorization)
        .expect(403);
    });

    it('validates merchant locations and protects Google Maps resolution by role', async () => {
      const validated = await request(app.getHttpServer())
        .post('/api/v1/location/validate')
        .set('Authorization', owner.authorization)
        .send({ latitude: 31.4321, longitude: 31.8273 })
        .expect(201);
      expect(validated.body).toMatchObject({
        supported: true,
        serviceZone: { city: 'دمياط' },
      });

      const resolved = await request(app.getHttpServer())
        .post('/api/v1/location/resolve-maps-link')
        .set('Authorization', owner.authorization)
        .send({
          url: 'https://www.google.com/maps/@31.440000,31.780000,15z',
        })
        .expect(201);
      expect(resolved.body).toMatchObject({
        status: 'COORDINATES_FOUND',
        latitude: 31.44,
        longitude: 31.78,
        extractionSource: 'EXPLICIT_COORDINATES',
        validation: { supported: true },
      });

      const manualSelection = await request(app.getHttpServer())
        .post('/api/v1/location/resolve-maps-link')
        .set('Authorization', owner.authorization)
        .send({
          url: 'https://www.google.com/maps/place/Damietta',
        })
        .expect(201);
      expect(manualSelection.body).toMatchObject({
        originalUrl: 'https://www.google.com/maps/place/Damietta',
        status: 'MANUAL_SELECTION_REQUIRED',
        latitude: null,
        longitude: null,
        validation: null,
        userMessage:
          'تم فتح الرابط، حدد الموقع بدقة على الخريطة ثم أكد النقطة.',
      });

      const outside = await request(app.getHttpServer())
        .post('/api/v1/location/validate')
        .set('Authorization', owner.authorization)
        .send({ latitude: 31.6, longitude: 32.1 })
        .expect(201);
      expect(outside.body).toEqual({
        supported: false,
        serviceZone: null,
      });

      await request(app.getHttpServer())
        .post('/api/v1/location/resolve-maps-link')
        .set('Authorization', courier.authorization)
        .send({
          url: 'https://www.google.com/maps/@31.440000,31.780000,15z',
        })
        .expect(403);
    });

    it('accepts one canonical recipient without email or optional address details', async () => {
      const canonicalName = 'مستلم موحد محدث';
      const quoted = await request(app.getHttpServer())
        .post('/api/v1/orders/quotes')
        .set('Authorization', owner.authorization)
        .set(
          'Idempotency-Key',
          `phase2-canonical-recipient-${idempotencySuffix}`,
        )
        .send({
          storeId,
          customer: {
            name: canonicalName,
            phone: customerPhone,
          },
          dropoff: {
            saveAddress: false,
            contactName: canonicalName,
            contactPhone: customerPhone,
            addressLine: '٢٥ شارع الجلاء بجوار البنك، دمياط',
            area: 'دمياط القديمة',
            city: 'دمياط',
            governorate: 'دمياط',
            locationSource: 'MAP_PICKER',
            latitude: 31.4321,
            longitude: 31.8273,
          },
          package: {
            category: 'documents',
            itemDescription: 'مستندات تحقق النموذج',
            size: 'small',
            weightGrams: 1_000,
            packageCount: 1,
            fragile: false,
            requiresThermalBag: false,
            declaredValueMinor: 10_000,
            prohibitedItemsConfirmed: true,
          },
        })
        .expect(201);

      expect(quoted.body.customerSnapshot).toMatchObject({
        name: canonicalName,
        normalizedPhone: customerPhone,
      });
      expect(quoted.body.dropoffAddressSnapshot).toMatchObject({
        contactName: canonicalName,
        contactPhone: customerPhone,
        street: null,
        buildingNumber: null,
        floor: null,
        apartment: null,
        landmark: null,
      });
    });

    it('quotes three latest locations deterministically without reusing a saved address', async () => {
      const idempotencyKey = `phase2-quote-${idempotencySuffix}`;
      const payload = {
        storeId,
        customer: { customerId },
        dropoff: { addressId },
        package: {
          category: 'documents',
          itemDescription: 'مستندات اختبار غير حساسة',
          size: 'small',
          weightGrams: 750,
          packageCount: 1,
          fragile: false,
          requiresThermalBag: false,
          recipientNotes: 'اختبار تكامل',
          courierNotes: 'لا توجد تعليمات تشغيلية',
          declaredValueMinor: 10_000,
          prohibitedItemsConfirmed: true,
          merchantReference: `IT-${uniqueDigits}`,
        },
      };

      const created = await request(app.getHttpServer())
        .post('/api/v1/orders/quotes')
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);
      quoteId = created.body.id as string;
      quoteVersion = created.body.version as number;
      expect(created.body).toMatchObject({
        status: 'ACTIVE',
        currency: 'EGP',
        discountMinor: 0,
        surgeAdjustmentMinor: 0,
        distanceMeters: 2494,
        durationSeconds: 374,
        merchantTotalMinor: 2247,
        dropoffAddressSnapshot: {
          latitude: 31.4321,
          longitude: 31.8273,
          locationSource: 'SAVED_ADDRESS',
        },
      });

      const replay = await request(app.getHttpServer())
        .post('/api/v1/orders/quotes')
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);
      expect(replay.body.id).toBe(quoteId);

      await request(app.getHttpServer())
        .post('/api/v1/orders/quotes')
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          ...payload,
          package: { ...payload.package, weightGrams: 751 },
        })
        .expect(409);

      const temporaryLocations = [
        {
          latitude: 31.44,
          longitude: 31.78,
          expectedDistance: 5059,
          expectedDuration: 759,
          expectedPrice: 3530,
        },
        {
          latitude: 31.5,
          longitude: 31.72,
          expectedDistance: 15767,
          expectedDuration: 2365,
          expectedPrice: 8884,
        },
      ];
      const temporaryQuotes = [];
      for (const [index, location] of temporaryLocations.entries()) {
        const temporary = await request(app.getHttpServer())
          .post('/api/v1/orders/quotes')
          .set('Authorization', owner.authorization)
          .set(
            'Idempotency-Key',
            `phase2-location-${index}-${idempotencySuffix}`,
          )
          .send({
            ...payload,
            dropoff: {
              label: `موقع خريطة ${index + 1}`,
              contactName: 'عميل تكامل تجريبي',
              contactPhone: customerPhone,
              addressLine: `موقع مؤقت رقم ${index + 1}، دمياط`,
              area: 'دمياط',
              city: 'دمياط',
              governorate: 'دمياط',
              latitude: location.latitude,
              longitude: location.longitude,
              locationSource: 'MAP_PICKER',
              saveAddress: false,
            },
          })
          .expect(201);
        expect(temporary.body).toMatchObject({
          distanceMeters: location.expectedDistance,
          durationSeconds: location.expectedDuration,
          merchantTotalMinor: location.expectedPrice,
          dropoffAddressSnapshot: {
            latitude: location.latitude,
            longitude: location.longitude,
            locationSource: 'MAP_PICKER',
          },
        });
        temporaryQuotes.push(temporary.body);
      }
      expect(
        [created.body, ...temporaryQuotes].map(
          (quoted) => quoted.distanceMeters,
        ),
      ).toEqual([2494, 5059, 15767]);
      expect(temporaryQuotes[1].merchantTotalMinor).toBeGreaterThan(
        temporaryQuotes[0].merchantTotalMinor,
      );
      quoteId = temporaryQuotes[1].id as string;
      quoteVersion = temporaryQuotes[1].version as number;
    });

    it('confirms one order concurrently and preserves immutable snapshots', async () => {
      const idempotencyKey = `phase2-order-${idempotencySuffix}`;
      const confirmation = () =>
        request(app.getHttpServer())
          .post('/api/v1/orders')
          .set('Authorization', owner.authorization)
          .set('Idempotency-Key', idempotencyKey)
          .send({ quoteId, quoteVersion, locationReviewed: true });
      const responses = await Promise.all([confirmation(), confirmation()]);
      expect(responses.map(({ status }) => status)).toEqual([201, 201]);
      expect(responses[0].body.id).toBe(responses[1].body.id);

      const order = responses[0].body;
      orderId = order.id as string;
      orderVersion = order.version as number;
      expect(order).toMatchObject({
        status: 'SEARCHING_COURIER',
        courierId: null,
        currency: 'EGP',
        prohibitedItemsConfirmed: true,
      });
      expect(order.pickupAddressSnapshot).toBeTruthy();
      expect(order.dropoffAddressSnapshot).toBeTruthy();
      expect(order.dropoffAddressSnapshot).toMatchObject({
        latitude: 31.5,
        longitude: 31.72,
        locationSource: 'MAP_PICKER',
      });
      expect(order.packageSnapshot).toBeTruthy();
      expect(order.pricingSnapshot).toBeTruthy();
      expect(
        order.events.map((event: { eventType: string }) => event.eventType),
      ).toEqual([
        'ORDER_DRAFT_CREATED',
        'QUOTE_CREATED',
        'ORDER_CONFIRMED',
        'COURIER_SEARCH_REQUESTED',
      ]);

      await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', courier.authorization)
        .expect(403);
    });

    it('cancels transactionally and exposes the admin audit timeline', async () => {
      const idempotencyKey = `phase2-cancel-${idempotencySuffix}`;
      const cancellation = {
        reasonCode: 'customer_cancelled',
        details: 'Synthetic integration cancellation.',
        version: orderVersion,
      };
      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', idempotencyKey)
        .send(cancellation)
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.courierId).toBeNull();

      const replay = await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', idempotencyKey)
        .send(cancellation)
        .expect(201);
      expect(replay.body.id).toBe(orderId);

      await request(app.getHttpServer())
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', idempotencyKey)
        .send({ ...cancellation, reasonCode: 'duplicate_order' })
        .expect(409);

      const inspected = await request(app.getHttpServer())
        .get(`/api/v1/admin/orders/${orderId}`)
        .set('Authorization', superAdmin.authorization)
        .expect(200);
      expect(inspected.body.events.at(-1).eventType).toBe('ORDER_CANCELLED');
      expect(
        inspected.body.audit.some(
          (entry: { action: string }) => entry.action === 'admin_order.viewed',
        ),
      ).toBe(true);
    });
  },
);
