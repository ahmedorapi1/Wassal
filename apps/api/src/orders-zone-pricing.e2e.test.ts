import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient, type PrismaClient } from '@wasel/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { OrdersService } from './orders/orders.service.js';

const ownerId = '30000000-0000-4000-8000-000000000001';
const storeId = '20000000-0000-4000-8000-000000000001';
const serviceZoneId = '80000000-0000-4000-8000-000000000001';

describe.sequential('quote service-zone pricing resolution', () => {
  let app: INestApplication;
  let database: PrismaClient;
  let orders: OrdersService;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for quote integration tests.');
    }
    database = createDatabaseClient(process.env.DATABASE_URL);
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    orders = app.get(OrdersService);
  });

  afterAll(async () => {
    await app.close();
    await database.$disconnect();
  });

  it('keeps a zone-specific active rule valid after editable zone metadata changes', async () => {
    const originalZone = await database.serviceZone.findUniqueOrThrow({
      where: { id: serviceZoneId },
      select: { city: true },
    });
    const directRule = await database.pricingRule.findFirstOrThrow({
      where: {
        serviceZoneId,
        status: 'ACTIVE',
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      select: { id: true },
    });
    const store = await database.$queryRaw<
      Array<{ latitude: number; longitude: number }>
    >`
      SELECT
        ST_Y("location"::geometry) AS "latitude",
        ST_X("location"::geometry) AS "longitude"
      FROM "Store"
      WHERE "id" = ${storeId}::uuid
    `;
    const point = store[0]!;
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`
      .slice(-8)
      .padStart(8, '0');
    const phone = `+2015${suffix}`;
    const idempotencyKey = `zone-metadata-pricing-${Date.now()}-${suffix}`;

    await database.serviceZone.update({
      where: { id: serviceZoneId },
      data: { city: `مدينة معدلة ${suffix}` },
    });

    try {
      const quote = await orders.createQuote(
        ownerId,
        {
          storeId,
          customer: {
            name: 'عميل اختبار ربط التسعير',
            phone,
          },
          dropoff: {
            saveAddress: false,
            contactName: 'عميل اختبار ربط التسعير',
            contactPhone: phone,
            addressLine: 'عنوان اختبار داخل نطاق الفرع',
            area: 'وسط دمياط',
            city: originalZone.city,
            governorate: 'دمياط',
            locationSource: 'MAP_PICKER',
            latitude: point.latitude,
            longitude: point.longitude,
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
        },
        idempotencyKey,
      );

      expect(quote.serviceZoneId).toBe(serviceZoneId);
      expect(quote.pricingRuleId).toBe(directRule.id);
      expect(quote.distanceMeters).toBeLessThanOrEqual(1);
    } finally {
      await database.serviceZone.update({
        where: { id: serviceZoneId },
        data: { city: originalZone.city },
      });
    }
  });
});
