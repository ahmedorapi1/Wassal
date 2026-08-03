import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient, type PrismaClient } from '@wasel/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';

type Session = { authorization: string };

describe.sequential('service-zone circle administration', () => {
  let app: INestApplication;
  let database: PrismaClient;
  let admin: Session;
  let owner: Session;
  let seededZone: {
    id: string;
    centerLatitude: string;
    centerLongitude: string;
    radiusKm: string;
    maximumRouteDistanceMeters: number;
    status: 'ACTIVE' | 'INACTIVE';
  };
  let trackedOrder: { id: string; status: string } | null;
  const createdZoneIds: string[] = [];
  const createdStoreIds: string[] = [];
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    database = createDatabaseClient(process.env.DATABASE_URL!);
    const existing = await database.serviceZone.findFirstOrThrow({
      where: {
        governorate: 'دمياط',
        pricingRules: { some: { status: 'ACTIVE' } },
      },
      select: {
        id: true,
        centerLatitude: true,
        centerLongitude: true,
        radiusKm: true,
        maximumRouteDistanceMeters: true,
        status: true,
      },
    });
    seededZone = {
      ...existing,
      centerLatitude: existing.centerLatitude.toString(),
      centerLongitude: existing.centerLongitude.toString(),
      radiusKm: existing.radiusKm.toString(),
    };
    trackedOrder = await database.deliveryOrder.findFirst({
      where: {
        status: {
          in: [
            'SEARCHING_COURIER',
            'COURIER_ASSIGNED',
            'PICKED_UP',
            'IN_TRANSIT',
          ],
        },
      },
      select: { id: true, status: true },
    });

    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
    admin = await login('+201001000005', 'AdminDemo123');
    owner = await login('+201001000001', 'MerchantDemo123');
  }, 120_000);

  afterAll(async () => {
    if (createdStoreIds.length > 0) {
      await database.store.deleteMany({
        where: { id: { in: createdStoreIds } },
      });
    }
    if (createdZoneIds.length > 0) {
      await database.serviceZone.deleteMany({
        where: { id: { in: createdZoneIds } },
      });
    }
    if (seededZone) {
      await database.$executeRaw`
        UPDATE "ServiceZone"
        SET
          "centerLatitude" = ${seededZone.centerLatitude},
          "centerLongitude" = ${seededZone.centerLongitude},
          "radiusKm" = ${seededZone.radiusKm},
          "maximumRouteDistanceMeters" = ${seededZone.maximumRouteDistanceMeters},
          "status" = ${seededZone.status}::"ServiceZoneStatus",
          "boundary" = ST_Multi(
            ST_Buffer(
              ST_SetSRID(
                ST_MakePoint(
                  ${Number(seededZone.centerLongitude)},
                  ${Number(seededZone.centerLatitude)}
                ),
                4326
              )::geography,
              ${Number(seededZone.radiusKm)} * 1000
            )::geometry
          )::geography,
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${seededZone.id}::uuid
      `;
    }
    await app?.close();
    await database?.$disconnect();
  }, 120_000);

  async function login(phone: string, password: string): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password })
      .expect(201);
    return {
      authorization: `Bearer ${response.body.tokens.accessToken as string}`,
    };
  }

  it('creates, edits, validates, deactivates, and reactivates one circle zone', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/service-zones')
      .set('Authorization', admin.authorization)
      .send({
        name: `منطقة دمياط الجديدة ${suffix}`,
        countryCode: 'EG',
        governorate: 'دمياط',
        city: 'دمياط الجديدة',
        centerLatitude: 31.4321,
        centerLongitude: 31.8273,
        radiusKm: 25,
        allowedPickup: true,
        allowedDropoff: true,
        maximumRouteDistanceMeters: 30_000,
        priority: 1_000,
      })
      .expect(201);
    const zoneId = created.body.id as string;
    createdZoneIds.push(zoneId);
    expect(created.body).toMatchObject({
      id: zoneId,
      status: 'INACTIVE',
      centerLatitude: 31.4321,
      centerLongitude: 31.8273,
      radiusKm: 25,
      maximumRouteDistanceMeters: 30_000,
    });

    const activated = await request(app.getHttpServer())
      .post(`/api/v1/admin/service-zones/${zoneId}/activate`)
      .set('Authorization', admin.authorization)
      .expect(201);
    expect(activated.body.status).toBe('ACTIVE');

    const inside = await request(app.getHttpServer())
      .post('/api/v1/location/validate-pickup')
      .set('Authorization', owner.authorization)
      .send({ latitude: 31.55, longitude: 31.8273 })
      .expect(201);
    expect(inside.body.serviceZone.id).toBe(zoneId);

    const outside = await request(app.getHttpServer())
      .post('/api/v1/location/validate-pickup')
      .set('Authorization', owner.authorization)
      .send({ latitude: 31.8, longitude: 31.8273 })
      .expect(201);
    expect(outside.body.supported).toBe(false);

    const beforeCount = await database.serviceZone.count();
    const expanded = await request(app.getHttpServer())
      .patch(`/api/v1/admin/service-zones/${zoneId}`)
      .set('Authorization', admin.authorization)
      .send({
        radiusKm: 35,
        centerLatitude: 31.4321,
        centerLongitude: 31.8273,
        maximumRouteDistanceMeters: 30_000,
        version: activated.body.version,
      })
      .expect(200);
    expect(expanded.body.id).toBe(zoneId);
    expect(expanded.body.radiusKm).toBe(35);
    expect(await database.serviceZone.count()).toBe(beforeCount);

    const newlyCovered = await request(app.getHttpServer())
      .post('/api/v1/location/validate-pickup')
      .set('Authorization', owner.authorization)
      .send({ latitude: 31.699, longitude: 31.8273 })
      .expect(201);
    expect(newlyCovered.body.serviceZone.id).toBe(zoneId);

    const branch = await request(app.getHttpServer())
      .post('/api/v1/merchants/current/stores')
      .set('Authorization', owner.authorization)
      .send({
        name: `فرع حافة النطاق ${suffix}`,
        phone: '01001000001',
        addressLine: 'عنوان اختباري على حافة منطقة الخدمة',
        governorate: 'دمياط',
        city: 'دمياط الجديدة',
        area: 'الامتداد الشمالي',
        street: 'شارع اختبار النطاق',
        addressDetails: 'بيانات صناعية لاختبار التغطية فقط',
        latitude: 31.699,
        longitude: 31.8273,
      });
    if (branch.status !== 201) {
      throw new Error(`Branch creation failed: ${JSON.stringify(branch.body)}`);
    }
    createdStoreIds.push(branch.body.id as string);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/service-zones/${zoneId}`)
      .set('Authorization', admin.authorization)
      .send({
        radiusKm: 5,
        centerLatitude: 31.4321,
        centerLongitude: 31.8273,
        version: expanded.body.version,
      })
      .expect(200);
    const stores = await request(app.getHttpServer())
      .get('/api/v1/merchants/current/stores')
      .set('Authorization', owner.authorization)
      .expect(200);
    expect(
      stores.body.find((store: { id: string }) => store.id === branch.body.id),
    ).toMatchObject({
      id: branch.body.id,
      coverageStatus: 'OUTSIDE_ACTIVE_ZONES',
    });

    const orderBefore = trackedOrder
      ? await database.deliveryOrder.findUnique({
          where: { id: trackedOrder.id },
          select: { status: true },
        })
      : null;
    const deactivated = await request(app.getHttpServer())
      .post(`/api/v1/admin/service-zones/${zoneId}/deactivate`)
      .set('Authorization', admin.authorization)
      .expect(201);
    expect(deactivated.body.status).toBe('INACTIVE');
    const validationWhileInactive = await request(app.getHttpServer())
      .post('/api/v1/location/validate-pickup')
      .set('Authorization', owner.authorization)
      .send({ latitude: 31.4321, longitude: 31.8273 })
      .expect(201);
    expect(validationWhileInactive.body.serviceZone?.id).not.toBe(zoneId);
    if (trackedOrder) {
      expect(
        await database.deliveryOrder.findUnique({
          where: { id: trackedOrder.id },
          select: { status: true },
        }),
      ).toEqual(orderBefore);
    }

    const reactivated = await request(app.getHttpServer())
      .post(`/api/v1/admin/service-zones/${zoneId}/activate`)
      .set('Authorization', admin.authorization)
      .expect(201);
    expect(reactivated.body).toMatchObject({
      status: 'ACTIVE',
      priority: 1_000,
      allowedPickup: true,
      radiusKm: 5,
    });
    const validationAfterReactivation = await request(app.getHttpServer())
      .post('/api/v1/location/validate-pickup')
      .set('Authorization', owner.authorization)
      .send({ latitude: 31.4321, longitude: 31.8273 })
      .expect(201);
    expect(validationAfterReactivation.body.serviceZone.id).toBe(zoneId);
  }, 120_000);

  it('prevents an exact active duplicate and keeps route limits separate', async () => {
    const primaryZoneId = createdZoneIds[0]!;
    const primary = await request(app.getHttpServer())
      .get(`/api/v1/admin/service-zones/${primaryZoneId}`)
      .set('Authorization', admin.authorization)
      .expect(200);
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/admin/service-zones')
      .set('Authorization', admin.authorization)
      .send({
        name: primary.body.name,
        countryCode: 'EG',
        governorate: 'دمياط',
        city: 'دمياط الجديدة',
        centerLatitude: primary.body.centerLatitude,
        centerLongitude: primary.body.centerLongitude,
        radiusKm: primary.body.radiusKm,
        allowedPickup: true,
        allowedDropoff: true,
        maximumRouteDistanceMeters: 30_000,
        priority: 999,
      })
      .expect(201);
    createdZoneIds.push(duplicate.body.id as string);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-zones/${duplicate.body.id}/activate`)
      .set('Authorization', admin.authorization)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-zones/${primaryZoneId}/deactivate`)
      .set('Authorization', admin.authorization)
      .expect(201);

    const seeded = await request(app.getHttpServer())
      .get(`/api/v1/admin/service-zones/${seededZone.id}`)
      .set('Authorization', admin.authorization)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/service-zones/${seededZone.id}`)
      .set('Authorization', admin.authorization)
      .send({
        centerLatitude: seeded.body.centerLatitude,
        centerLongitude: seeded.body.centerLongitude,
        radiusKm: 35,
        maximumRouteDistanceMeters: 1_000,
        version: seeded.body.version,
      })
      .expect(200);

    const stores = await request(app.getHttpServer())
      .get('/api/v1/merchants/current/stores')
      .set('Authorization', owner.authorization)
      .expect(200);
    const pickup = stores.body.find(
      (store: { id: string }) => store.id === createdStoreIds[0],
    );
    expect(pickup).toBeDefined();
    await request(app.getHttpServer())
      .post('/api/v1/orders/quotes')
      .set('Authorization', owner.authorization)
      .set('Idempotency-Key', `zone-route-${suffix}`)
      .send({
        storeId: pickup.id,
        customer: {
          name: 'عميل اختبار مسافة المسار',
          phone: `+2015${Date.now().toString().slice(-8)}`,
        },
        dropoff: {
          label: 'موقع داخل نصف القطر',
          contactName: 'عميل اختبار مسافة المسار',
          contactPhone: '+201501234567',
          addressLine: 'عنوان داخل دائرة التغطية وبعيد عن نقطة الاستلام',
          area: 'دمياط الجديدة',
          city: 'دمياط',
          governorate: 'دمياط',
          latitude: 31.45,
          longitude: 31.85,
          locationSource: 'MAP_PICKER',
          saveAddress: false,
        },
        package: {
          category: 'documents',
          itemDescription: 'مستندات اختبار',
          size: 'small',
          weightGrams: 500,
          packageCount: 1,
          fragile: false,
          requiresThermalBag: false,
          declaredValueMinor: 1_000,
          prohibitedItemsConfirmed: true,
        },
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('order_route_distance_exceeded');
      });
  }, 120_000);

  it('permanently deletes only an unused inactive zone and rejects a linked zone', async () => {
    const orphanZoneId = randomUUID();
    createdZoneIds.push(orphanZoneId);
    await database.$executeRaw`
      INSERT INTO "ServiceZone" (
        "id",
        "name",
        "countryCode",
        "governorate",
        "city",
        "centerLatitude",
        "centerLongitude",
        "radiusKm",
        "boundary",
        "status",
        "allowedPickup",
        "allowedDropoff",
        "maximumRouteDistanceMeters",
        "priority",
        "version",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${orphanZoneId}::uuid,
        ${`منطقة حذف آمن ${suffix}`},
        'EG',
        'اختبار',
        'اختبار',
        0,
        0,
        0.1,
        ST_Multi(
          ST_Buffer(
            ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography,
            100
          )::geometry
        )::geography,
        'INACTIVE'::"ServiceZoneStatus",
        true,
        true,
        1_000,
        -1,
        1,
        NOW(),
        NOW()
      )
    `;

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/service-zones/${orphanZoneId}`)
      .set('Authorization', owner.authorization)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/service-zones/${orphanZoneId}`)
      .set('Authorization', admin.authorization)
      .expect(200)
      .expect({ deleted: true, id: orphanZoneId });

    expect(
      await database.serviceZone.count({ where: { id: orphanZoneId } }),
    ).toBe(0);
    expect(
      await database.auditLog.count({
        where: {
          action: 'service_zone.deleted',
          entityId: orphanZoneId,
          entityType: 'ServiceZone',
        },
      }),
    ).toBe(1);
    createdZoneIds.splice(createdZoneIds.indexOf(orphanZoneId), 1);

    const linkedZone = await request(app.getHttpServer())
      .get(`/api/v1/admin/service-zones/${seededZone.id}`)
      .set('Authorization', admin.authorization)
      .expect(200);
    if (linkedZone.body.status === 'ACTIVE') {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/service-zones/${seededZone.id}/deactivate`)
        .set('Authorization', admin.authorization)
        .expect(201);
    }

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/service-zones/${seededZone.id}`)
      .set('Authorization', admin.authorization)
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain(
          'لا يمكن حذف منطقة الخدمة لأنها مرتبطة بفروع أو طلبات أو قواعد تسعير. يمكنك إيقافها بدلًا من حذفها.',
        );
      });
    expect(
      await database.serviceZone.count({ where: { id: seededZone.id } }),
    ).toBe(1);
  }, 120_000);
});
