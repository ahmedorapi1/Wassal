import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient, type PrismaClient } from '@wasel/database';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expireCourierAcceptanceWindows } from '../../worker/src/order-acceptance-timeout.js';
import { requiredCourierDocumentTypes } from './courier/courier-policy.js';
import { AppModule } from './app.module.js';
import { OrderFinalizationService } from './orders/order-finalization.service.js';

type Persona = {
  authorization: string;
  phone: string;
};

type CreatedOrder = {
  currency: string;
  declaredValueMinor: number;
  estimatedCourierEarningMinor: number;
  financialDetails?: {
    currency: string;
    customerCollectAmountMinor: number;
    courierNetEarningMinor: number;
    deliveryFeeMinor: number;
    itemsSubtotalMinor: number;
    merchantPaymentRequiredMinor: number;
    paymentMode: string;
    platformCommissionMinor: number;
  };
  id: string;
  version: number;
  status: string;
  platformCommissionMinor: number;
  platformCommissionBasisPoints: number;
  merchantTotalMinor: number;
  cancelledAfterPickup?: boolean;
  cancellationChargeMinor?: number;
  courierId?: string | null;
};

describe.sequential(
  'Phase 3 marketplace, lifecycle, and accounting E2E',
  () => {
    let app: INestApplication;
    let database: PrismaClient;
    let owner: Persona;
    let financeAdmin: Persona;
    let operationsAdmin: Persona;
    let couriers: Persona[];
    let storeId: string;
    let customerId: string;
    let addressId: string;
    let zoneId: string;
    let winningCourier: Persona;
    let winningCourierId: string;
    let completedOrder: CreatedOrder;
    let settlementId: string;
    let activeCommissionBasisPoints: number;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const courierPhones = Array.from({ length: 10 }, (_, index) => {
      const suffix = `${Date.now().toString().slice(-6)}${index
        .toString()
        .padStart(2, '0')}`;
      return `+2015${suffix}`;
    });
    const seededPhones = ['+201001000001', '+201001000004', '+201001000006'];
    const allPhones = [...seededPhones, ...courierPhones];

    beforeAll(async () => {
      if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
        throw new Error(
          'DATABASE_URL and REDIS_URL are required for Phase 3 E2E tests.',
        );
      }
      database = createDatabaseClient(process.env.DATABASE_URL);
      const activeZone = await database.serviceZone.findFirstOrThrow({
        where: { status: 'ACTIVE' },
        orderBy: { priority: 'desc' },
      });
      zoneId = activeZone.id;
      await createEligibleCouriers(database, zoneId, courierPhones, runId);
      await clearOtpState(database, allPhones);

      app = await NestFactory.create(AppModule, { logger: ['error'] });
      app.setGlobalPrefix('api/v1');
      await app.init();
      owner = await authenticate('+201001000001');
      operationsAdmin = await authenticate('+201001000004');
      financeAdmin = await authenticate('+201001000006');
      couriers = [];
      for (const phone of courierPhones) {
        couriers.push(await authenticate(phone));
      }

      const stores = await request(app.getHttpServer())
        .get('/api/v1/merchants/current/stores')
        .set('Authorization', owner.authorization)
        .expect(200);
      storeId = stores.body[0].id as string;
      const customers = await request(app.getHttpServer())
        .get('/api/v1/merchant/customers')
        .set('Authorization', owner.authorization)
        .expect(200);
      for (const candidate of customers.body as Array<{ id: string }>) {
        const customer = await request(app.getHttpServer())
          .get(`/api/v1/merchant/customers/${candidate.id}`)
          .set('Authorization', owner.authorization)
          .expect(200);
        if (customer.body.addresses[0]?.id) {
          customerId = candidate.id;
          addressId = customer.body.addresses[0].id as string;
          break;
        }
      }
      if (!customerId || !addressId) {
        throw new Error('A seeded customer with an address is required.');
      }
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await database?.$disconnect();
      if (process.env.REDIS_URL) {
        const redis = new Redis(process.env.REDIS_URL);
        const keys = [
          ...(await redis.keys('otp:ip:*')),
          ...(await redis.keys('otp:verify:*')),
          ...allPhones.map((phone) => `otp:phone:${phone}`),
        ];
        if (keys.length > 0) await redis.del(...keys);
        await redis.quit();
      }
    });

    async function authenticate(phone: string): Promise<Persona> {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/request-otp')
        .send({ phone })
        .expect(201);
      const verified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({
          challengeId: challenge.body.challengeId,
          code: process.env.OTP_MOCK_CODE ?? '123456',
        })
        .expect(201);
      return {
        phone,
        authorization: `Bearer ${verified.body.tokens.accessToken as string}`,
      };
    }

    async function createOrder(label: string): Promise<CreatedOrder> {
      const quote = await request(app.getHttpServer())
        .post('/api/v1/orders/quotes')
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-quote-${label}-${runId}`)
        .send({
          storeId,
          customer: { customerId },
          dropoff: { addressId },
          package: {
            category: 'documents',
            itemDescription: `Synthetic Phase 3 ${label}`,
            size: 'small',
            weightGrams: 1_000,
            packageCount: 1,
            fragile: false,
            requiresThermalBag: false,
            courierNotes: 'Phase 3 integration test only.',
            declaredValueMinor: 10_000,
            prohibitedItemsConfirmed: true,
            merchantReference: `P3-${label}-${runId}`,
          },
        })
        .expect(201);
      expect(quote.body.platformCommissionBasisPoints).toBe(
        activeCommissionBasisPoints,
      );
      expect(quote.body.platformCommissionMinor).toBe(
        Math.round(
          (Number(quote.body.merchantTotalMinor) *
            activeCommissionBasisPoints) /
            10_000,
        ),
      );

      const order = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-order-${label}-${runId}`)
        .send({
          quoteId: quote.body.id,
          quoteVersion: quote.body.version,
          locationReviewed: true,
        })
        .expect(201);
      return order.body as CreatedOrder;
    }

    async function acceptOrder(
      courier: Persona,
      order: CreatedOrder,
      suffix: string,
    ) {
      return request(app.getHttpServer())
        .post(`/api/v1/couriers/orders/${order.id}/accept`)
        .set('Authorization', courier.authorization)
        .set('Idempotency-Key', `phase3-accept-${suffix}-${runId}`)
        .send({ version: order.version });
    }

    async function transition(
      courier: Persona,
      orderId: string,
      path: string,
      version: number,
    ): Promise<CreatedOrder> {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/couriers/orders/${orderId}/${path}`)
        .set('Authorization', courier.authorization)
        .set('Idempotency-Key', `phase3-${path}-${orderId}-${runId}`)
        .send({ version });
      if (response.status !== 200) {
        throw new Error(
          `${path} returned ${response.status}: ${JSON.stringify(response.body)}`,
        );
      }
      return response.body as CreatedOrder;
    }

    it('uses the active versioned commission setting and exposes only zone-safe marketplace fields', async () => {
      const settings = await request(app.getHttpServer())
        .get('/api/v1/admin/financial-settings')
        .set('Authorization', financeAdmin.authorization)
        .expect(200);
      expect(settings.body.current).toMatchObject({
        settlementCycle: 'WEEKLY',
        operationsTimezone: 'Africa/Cairo',
      });
      activeCommissionBasisPoints = Number(
        settings.body.current.defaultCommissionBasisPoints,
      );
      expect(activeCommissionBasisPoints).toBeGreaterThanOrEqual(0);
      expect(activeCommissionBasisPoints).toBeLessThanOrEqual(10_000);

      completedOrder = await createOrder('delivered');
      const available = await request(app.getHttpServer())
        .get('/api/v1/couriers/orders/available?page=1&pageSize=100')
        .set('Authorization', couriers[0]!.authorization)
        .expect(200);
      const card = (
        available.body.items as Array<Record<string, unknown>>
      ).find((item) => item.id === completedOrder.id);
      expect(card).toBeTruthy();
      expect(card).toMatchObject({
        id: completedOrder.id,
        serviceZoneName: expect.any(String),
        estimatedCourierNetMinor: expect.any(Number),
      });
      expect(card).not.toHaveProperty('customerSnapshot');
      expect(card).not.toHaveProperty('dropoffAddressSnapshot');
      expect(card).not.toHaveProperty('customerPhone');
    });

    it('allows exactly one of 10 eligible couriers to accept atomically', async () => {
      const responses = await Promise.all(
        couriers.map((courier, index) =>
          acceptOrder(courier, completedOrder, `race-${index}`),
        ),
      );
      const successes = responses
        .map((response, index) => ({ response, index }))
        .filter(({ response }) => response.status === 201);
      expect(successes).toHaveLength(1);
      expect(
        responses.filter((response) => response.status === 409),
      ).toHaveLength(9);
      winningCourier = couriers[successes[0]!.index]!;
      const assigned = successes[0]!.response.body as CreatedOrder & {
        courierId: string;
        customerSnapshot: unknown;
        dropoffAddressSnapshot: unknown;
      };
      winningCourierId = assigned.courierId;
      completedOrder = assigned;
      expect(assigned.status).toBe('COURIER_ASSIGNED');
      expect(assigned.version).toBe(2);
      expect(assigned.customerSnapshot).toBeTruthy();
      expect(assigned.dropoffAddressSnapshot).toBeTruthy();
      expect(assigned.financialDetails).toEqual({
        currency: assigned.currency,
        itemsSubtotalMinor: assigned.declaredValueMinor,
        deliveryFeeMinor: assigned.merchantTotalMinor,
        customerCollectAmountMinor: assigned.merchantTotalMinor,
        courierNetEarningMinor: assigned.estimatedCourierEarningMinor,
        platformCommissionMinor: assigned.platformCommissionMinor,
        paymentMode: 'delivery_only',
        merchantPaymentRequiredMinor: 0,
      });

      const currentOrder = await request(app.getHttpServer())
        .get('/api/v1/couriers/orders/current')
        .set('Authorization', winningCourier.authorization)
        .expect(200);
      expect(currentOrder.body.financialDetails).toEqual(
        assigned.financialDetails,
      );

      const persisted = await database.deliveryOrder.findUniqueOrThrow({
        where: { id: completedOrder.id },
        include: {
          events: { where: { eventType: 'COURIER_ACCEPTED' } },
        },
      });
      const audits = await database.auditLog.count({
        where: {
          entityType: 'DeliveryOrder',
          entityId: completedOrder.id,
          action: 'courier_order.accepted',
        },
      });
      const acceptedOffers = await database.dispatchOffer.count({
        where: { orderId: completedOrder.id, status: 'ACCEPTED' },
      });
      expect(persisted.courierId).toBe(winningCourierId);
      expect(persisted.events).toHaveLength(1);
      expect(audits).toBe(1);
      expect(acceptedOffers).toBe(0);
    });

    it('completes delivery once and creates exactly one commission line', async () => {
      for (const path of [
        'arriving-pickup',
        'arrived-pickup',
        'picked-up',
        'in-transit',
        'arrived-dropoff',
        'delivered',
      ]) {
        completedOrder = await transition(
          winningCourier,
          completedOrder.id,
          path,
          completedOrder.version,
        );
      }
      expect(completedOrder.status).toBe('DELIVERED');
      expect(
        await database.courierLedgerEntry.count({
          where: {
            orderId: completedOrder.id,
            type: 'COMMISSION_DUE',
          },
        }),
      ).toBe(0);
      completedOrder = (await app
        .get(OrderFinalizationService)
        .finalize(completedOrder.id, {
          expectedStatuses: ['DELIVERED'],
          completionSource: 'DISPUTE_WINDOW_EXPIRED',
          eventSource: 'WORKER',
        })) as CreatedOrder;
      expect(completedOrder.status).toBe('COMPLETED');
      const ledger = await database.courierLedgerEntry.findMany({
        where: {
          orderId: completedOrder.id,
          type: 'COMMISSION_DUE',
        },
        include: { settlementLine: true },
      });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.amountMinor).toBe(
        completedOrder.platformCommissionMinor,
      );
      expect(ledger[0]!.settlementLine).toBeTruthy();
      settlementId = ledger[0]!.settlementLine!.settlementPeriodId;
    });

    it('closes the weekly statement and reconciles partial then final external payment', async () => {
      const ledger = await database.courierLedgerEntry.findFirstOrThrow({
        where: { orderId: completedOrder.id, type: 'COMMISSION_DUE' },
      });
      const closeBoundary = new Date(ledger.occurredAt.getTime() + 1);
      await database.settlementPeriod.update({
        where: { id: settlementId },
        data: {
          periodEnd: closeBoundary,
          dueAt: new Date(closeBoundary.getTime() + 7 * 24 * 60 * 60 * 1_000),
        },
      });
      const period = await database.settlementPeriod.findUniqueOrThrow({
        where: { id: settlementId },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/admin/settlements/${settlementId}/close`)
        .set('Authorization', financeAdmin.authorization)
        .set('Idempotency-Key', `phase3-close-${runId}`)
        .send({ version: period.version })
        .expect(200);

      const partial = Math.max(
        1,
        Math.floor(completedOrder.platformCommissionMinor / 2),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/admin/couriers/${winningCourierId}/external-payments`)
        .set('Authorization', financeAdmin.authorization)
        .set('Idempotency-Key', `phase3-partial-payment-${runId}`)
        .send({
          amountMinor: partial,
          currency: 'EGP',
          paidAt: new Date().toISOString(),
          method: 'CASH',
          externalReference: `PARTIAL-${runId}`,
        })
        .expect(201);
      let statement = await request(app.getHttpServer())
        .get(`/api/v1/admin/settlements/${settlementId}`)
        .set('Authorization', financeAdmin.authorization)
        .expect(200);
      expect(statement.body.status).toBe('PARTIALLY_PAID');
      const remainder = Number(statement.body.remainingAmountMinor);
      expect(remainder).toBe(completedOrder.platformCommissionMinor - partial);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/couriers/${winningCourierId}/external-payments`)
        .set('Authorization', financeAdmin.authorization)
        .set('Idempotency-Key', `phase3-final-payment-${runId}`)
        .send({
          amountMinor: remainder,
          currency: 'EGP',
          paidAt: new Date().toISOString(),
          method: 'BANK_TRANSFER',
          externalReference: `FINAL-${runId}`,
        })
        .expect(201);
      statement = await request(app.getHttpServer())
        .get(`/api/v1/admin/settlements/${settlementId}`)
        .set('Authorization', financeAdmin.authorization)
        .expect(200);
      expect(statement.body).toMatchObject({
        status: 'PAID',
        remainingAmountMinor: 0,
      });
      const courierSummary = await request(app.getHttpServer())
        .get('/api/v1/couriers/account/summary')
        .set('Authorization', winningCourier.authorization)
        .expect(200);
      expect(courierSummary.body.remainingAmountMinor).toBe(0);
    });

    it('enforces financial ownership and role separation', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/couriers/account/summary')
        .set('Authorization', owner.authorization)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/admin/couriers/${winningCourierId}/account`)
        .set('Authorization', couriers[1]!.authorization)
        .expect(403);

      const settings = await database.platformFinancialSetting.findFirstOrThrow(
        {
          orderBy: { version: 'desc' },
        },
      );
      await request(app.getHttpServer())
        .patch('/api/v1/admin/financial-settings')
        .set('Authorization', operationsAdmin.authorization)
        .send({
          version: settings.version,
          defaultCommissionBasisPoints: 2_100,
          settlementCycle: 'WEEKLY',
          gracePeriodDays: 7,
          operationsTimezone: 'Africa/Cairo',
        })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/admin/couriers/${winningCourierId}/adjustments`)
        .set('Authorization', financeAdmin.authorization)
        .set('Idempotency-Key', `phase3-forbidden-waiver-${runId}`)
        .send({
          type: 'WAIVER',
          amountMinor: 1,
          reason: 'Finance admins cannot waive without elevated permission.',
        })
        .expect(403);
    });

    it('completes the typed failed-delivery return journey without a second commission', async () => {
      let returned = await createOrder('returned');
      const accepted = await acceptOrder(couriers[1]!, returned, 'returned');
      expect(accepted.status).toBe(201);
      returned = accepted.body as CreatedOrder;
      for (const path of [
        'arriving-pickup',
        'arrived-pickup',
        'picked-up',
        'in-transit',
      ]) {
        returned = await transition(
          couriers[1]!,
          returned.id,
          path,
          returned.version,
        );
      }
      let failedResponse = await request(app.getHttpServer())
        .post(`/api/v1/couriers/orders/${returned.id}/delivery-failed`)
        .set('Authorization', couriers[1]!.authorization)
        .set(
          'Idempotency-Key',
          `phase3-delivery-failed-${returned.id}-${runId}`,
        )
        .send({
          version: returned.version,
          reason: 'CUSTOMER_ABSENT',
          note: 'Synthetic Phase 4 return test.',
        })
        .expect(200);
      returned = failedResponse.body as CreatedOrder;
      for (const path of ['returning-to-store', 'returned']) {
        returned = await transition(
          couriers[1]!,
          returned.id,
          path,
          returned.version,
        );
      }
      expect(returned.status).toBe('RETURN_AWAITING_MERCHANT_CONFIRMATION');
      failedResponse = await request(app.getHttpServer())
        .post(`/api/v1/merchant/orders/${returned.id}/confirm-return`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-confirm-return-${returned.id}-${runId}`)
        .send({ version: returned.version, condition: 'INTACT' })
        .expect(201);
      returned = failedResponse.body as CreatedOrder;
      expect(returned.status).toBe('COMPLETED');
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: returned.id, type: 'COMMISSION_DUE' },
        }),
      ).toBe(1);
      expect(
        await database.orderEvent.findMany({
          where: { orderId: returned.id },
          orderBy: { createdAt: 'asc' },
          select: { eventType: true },
        }),
      ).toEqual(
        expect.arrayContaining([
          { eventType: 'DELIVERY_FAILED' },
          { eventType: 'RETURNING_TO_STORE' },
          { eventType: 'RETURN_AWAITING_MERCHANT_CONFIRMATION' },
          { eventType: 'RETURN_CONFIRMED' },
          { eventType: 'ORDER_COMPLETED' },
        ]),
      );
    });

    it('requeues a pre-pickup cancellation and lets a different courier accept', async () => {
      let reassigned = await createOrder('reassigned');
      const first = await acceptOrder(couriers[2]!, reassigned, 'cancel-first');
      expect(first.status).toBe(201);
      reassigned = first.body as CreatedOrder;
      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/couriers/orders/${reassigned.id}/cancel`)
        .set('Authorization', couriers[2]!.authorization)
        .set('Idempotency-Key', `phase3-cancel-before-pickup-${runId}`)
        .send({
          version: reassigned.version,
          reason: 'Synthetic courier cannot continue before pickup.',
        })
        .expect(200);
      expect(cancelled.body.id).toBe(reassigned.id);
      expect(cancelled.body).not.toHaveProperty('status');
      const requeued = await database.deliveryOrder.findUniqueOrThrow({
        where: { id: reassigned.id },
      });
      expect(requeued).toMatchObject({
        status: 'SEARCHING_COURIER',
        courierId: null,
      });
      const second = await acceptOrder(
        couriers[3]!,
        {
          ...reassigned,
          version: requeued.version,
          status: requeued.status,
        },
        'cancel-second',
      );
      expect(second.status).toBe(201);
      expect(second.body.courierId).not.toBe(first.body.courierId);
    });

    it('rejects a courier acceptance at or after the persisted deadline', async () => {
      const order = await createOrder('late-acceptance');
      const expired = await database.deliveryOrder.update({
        where: { id: order.id },
        data: {
          acceptanceExpiresAt: new Date(Date.now() - 1),
          version: { increment: 1 },
        },
      });
      const response = await acceptOrder(
        couriers[6]!,
        { ...order, version: expired.version },
        'late-acceptance',
      );
      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain(
        'انتهت مدة قبول هذا الطلب',
      );
      expect(
        await database.deliveryOrder.findUniqueOrThrow({
          where: { id: order.id },
          select: { courierId: true, status: true },
        }),
      ).toEqual({ courierId: null, status: 'SEARCHING_COURIER' });
    });

    it('serializes courier acceptance against the worker at the expired deadline', async () => {
      const order = await createOrder('accept-timeout-race');
      const deadline = new Date();
      const expired = await database.deliveryOrder.update({
        where: { id: order.id },
        data: {
          acceptanceExpiresAt: deadline,
          version: { increment: 1 },
        },
      });

      const [acceptance, expiredCount] = await Promise.all([
        acceptOrder(
          couriers[9]!,
          { ...order, version: expired.version },
          'accept-timeout-race',
        ),
        expireCourierAcceptanceWindows(
          database,
          new Date(deadline.getTime() + 1),
        ),
      ]);

      expect(acceptance.status).toBe(409);
      expect(JSON.stringify(acceptance.body)).toContain(
        'COURIER_ACCEPTANCE_EXPIRED',
      );
      expect(expiredCount).toBeGreaterThanOrEqual(1);
      expect(
        await database.deliveryOrder.findUniqueOrThrow({
          where: { id: order.id },
          select: { courierId: true, status: true },
        }),
      ).toEqual({
        courierId: null,
        status: 'NO_COURIER_AVAILABLE',
      });
      expect(
        await database.orderEvent.count({
          where: { orderId: order.id, eventType: 'COURIER_SEARCH_EXPIRED' },
        }),
      ).toBe(1);
      expect(
        await database.orderEvent.count({
          where: { orderId: order.id, eventType: 'COURIER_ACCEPTED' },
        }),
      ).toBe(0);
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: order.id },
        }),
      ).toBe(0);
    });

    it('restarts only the first timed-out search idempotently and blocks a third attempt', async () => {
      const order = await createOrder('merchant-retry-search');
      const timedOut = await database.deliveryOrder.update({
        where: { id: order.id },
        data: {
          status: 'NO_COURIER_AVAILABLE',
          acceptanceExpiresAt: null,
          dispatchAttemptCount: 1,
          version: { increment: 1 },
        },
      });
      const key = `phase3-retry-search-${runId}`;
      const retried = await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/retry-courier-search`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', key)
        .send({ version: timedOut.version })
        .expect(201);
      expect(retried.body).toMatchObject({
        status: 'SEARCHING_COURIER',
        dispatchAttemptCount: 2,
      });
      expect(
        new Date(retried.body.acceptanceExpiresAt as string).getTime() -
          Date.now(),
      ).toBeGreaterThan(4 * 60 * 1_000);
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/retry-courier-search`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', key)
        .send({ version: timedOut.version })
        .expect(201);
      expect(
        await database.orderEvent.count({
          where: { orderId: order.id, eventType: 'COURIER_SEARCH_RESTARTED' },
        }),
      ).toBe(1);

      const finalTimeout = await database.deliveryOrder.update({
        where: { id: order.id },
        data: {
          status: 'NO_COURIER_AVAILABLE_FINAL',
          acceptanceExpiresAt: null,
          version: { increment: 1 },
        },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/retry-courier-search`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-retry-third-${runId}`)
        .send({ version: finalTimeout.version })
        .expect(409);
    });

    it('serializes merchant cancellation against courier acceptance', async () => {
      const order = await createOrder('cancel-accept-race');
      const [acceptance, cancellation] = await Promise.all([
        acceptOrder(couriers[7]!, order, 'cancel-accept-race'),
        request(app.getHttpServer())
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', owner.authorization)
          .set('Idempotency-Key', `phase3-cancel-accept-race-${runId}`)
          .send({
            version: order.version,
            reasonCode: 'customer_cancelled',
            details: 'Synthetic cancellation versus acceptance race.',
          }),
      ]);
      expect([acceptance.status, cancellation.status].sort()).toEqual([
        201, 409,
      ]);
      const persisted = await database.deliveryOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(['COURIER_ASSIGNED', 'CANCELLED']).toContain(persisted.status);
      expect(
        (await database.orderEvent.count({
          where: { orderId: order.id, eventType: 'COURIER_ACCEPTED' },
        })) +
          (await database.orderEvent.count({
            where: { orderId: order.id, eventType: 'ORDER_CANCELLED' },
          })),
      ).toBe(1);
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: order.id },
        }),
      ).toBe(0);
    });

    it('serializes post-pickup cancellation against the courier leaving pickup', async () => {
      let order = await createOrder('cancel-after-pickup-race');
      const accepted = await acceptOrder(
        couriers[8]!,
        order,
        'cancel-after-pickup-race',
      );
      expect(accepted.status).toBe(201);
      order = accepted.body as CreatedOrder;
      for (const path of ['arriving-pickup', 'arrived-pickup', 'picked-up']) {
        order = await transition(couriers[8]!, order.id, path, order.version);
      }
      const [movement, cancellation] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/couriers/orders/${order.id}/in-transit`)
          .set('Authorization', couriers[8]!.authorization)
          .set(
            'Idempotency-Key',
            `phase3-pickup-movement-race-${order.id}-${runId}`,
          )
          .send({ version: order.version }),
        request(app.getHttpServer())
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', owner.authorization)
          .set('Idempotency-Key', `phase3-post-pickup-race-${runId}`)
          .send({
            version: order.version,
            reasonCode: 'customer_cancelled',
            details: 'Synthetic post-pickup cancellation race.',
          }),
      ]);
      expect([movement.status, cancellation.status]).toContain(409);
      expect(
        [movement.status, cancellation.status].some((status) =>
          [200, 201].includes(status),
        ),
      ).toBe(true);

      let persisted = await database.deliveryOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      if (persisted.status === 'IN_TRANSIT') {
        await request(app.getHttpServer())
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', owner.authorization)
          .set('Idempotency-Key', `phase3-post-pickup-race-retry-${runId}`)
          .send({
            version: persisted.version,
            reasonCode: 'customer_cancelled',
            details: 'Synthetic post-pickup cancellation race.',
          })
          .expect(201);
        persisted = await database.deliveryOrder.findUniqueOrThrow({
          where: { id: order.id },
        });
      }
      expect(persisted).toMatchObject({
        status: 'RETURNING_TO_STORE',
        cancelledAfterPickup: true,
        cancellationChargeMinor: persisted.merchantTotalMinor,
      });
    });

    it('lets the merchant cancel an assigned order for free and removes it from the courier', async () => {
      let order = await createOrder('merchant-cancel-before-pickup');
      const accepted = await acceptOrder(
        couriers[4]!,
        order,
        'merchant-cancel-before-pickup',
      );
      expect(accepted.status).toBe(201);
      order = accepted.body as CreatedOrder;
      const key = `phase3-merchant-free-cancel-${runId}`;
      const payload = {
        version: order.version,
        reasonCode: 'customer_cancelled',
        details: 'Synthetic merchant cancellation before pickup.',
      };
      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        courierId: null,
        cancelledAfterPickup: false,
        cancellationChargeMinor: 0,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      expect(
        await database.orderEvent.count({
          where: { orderId: order.id, eventType: 'ORDER_CANCELLED' },
        }),
      ).toBe(1);
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: order.id },
        }),
      ).toBe(0);
      const cancelledCourier = await database.courierProfile.findFirstOrThrow({
        where: { user: { phone: couriers[4]!.phone } },
        select: { userId: true },
      });
      expect(
        await database.notification.count({
          where: {
            recipientUserId: cancelledCourier.userId,
            relatedEntityId: order.id,
            type: 'ORDER_CANCELLED_BY_MERCHANT',
          },
        }),
      ).toBe(1);
    });

    it('lets the merchant cancel while the courier is heading to pickup for free', async () => {
      let order = await createOrder('merchant-cancel-heading-to-pickup');
      const courier = couriers[3]!;
      const accepted = await acceptOrder(
        courier,
        order,
        'merchant-cancel-heading-to-pickup',
      );
      expect(accepted.status).toBe(201);
      order = accepted.body as CreatedOrder;
      order = await transition(
        courier,
        order.id,
        'arriving-pickup',
        order.version,
      );
      expect(order.status).toBe('COURIER_ARRIVING_PICKUP');

      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-merchant-heading-cancel-${runId}`)
        .send({
          version: order.version,
          reasonCode: 'customer_cancelled',
          details: 'Synthetic cancellation while heading to pickup.',
        })
        .expect(201);

      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        courierId: null,
        cancelledAfterPickup: false,
        cancellationChargeMinor: 0,
      });
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: order.id },
        }),
      ).toBe(0);
      const cancelledCourier = await database.courierProfile.findFirstOrThrow({
        where: { user: { phone: courier.phone } },
        select: { userId: true },
      });
      expect(
        await database.notification.count({
          where: {
            recipientUserId: cancelledCourier.userId,
            relatedEntityId: order.id,
            type: 'ORDER_CANCELLED_BY_MERCHANT',
          },
        }),
      ).toBe(1);
    });

    it('turns merchant cancellation after pickup into the normal return and one settlement', async () => {
      let order = await createOrder('merchant-cancel-after-pickup');
      const accepted = await acceptOrder(
        couriers[5]!,
        order,
        'merchant-cancel-after-pickup',
      );
      expect(accepted.status).toBe(201);
      order = accepted.body as CreatedOrder;
      for (const path of ['arriving-pickup', 'arrived-pickup', 'picked-up']) {
        order = await transition(couriers[5]!, order.id, path, order.version);
      }
      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-merchant-return-cancel-${runId}`)
        .send({
          version: order.version,
          reasonCode: 'customer_cancelled',
          details: 'Synthetic merchant cancellation after pickup.',
        })
        .expect(201);
      order = cancelled.body as CreatedOrder;
      expect(order).toMatchObject({
        status: 'RETURNING_TO_STORE',
        cancelledAfterPickup: true,
        cancellationChargeMinor: order.merchantTotalMinor,
      });
      expect(order.courierId).toBeTruthy();
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: order.id },
        }),
      ).toBe(0);

      order = await transition(
        couriers[5]!,
        order.id,
        'returned',
        order.version,
      );
      const completed = await request(app.getHttpServer())
        .post(`/api/v1/merchant/orders/${order.id}/confirm-return`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', `phase3-confirm-merchant-return-${runId}`)
        .send({ version: order.version, condition: 'INTACT' })
        .expect(201);
      expect(completed.body.status).toBe('COMPLETED');
      expect(completed.body.cancellationChargeMinor).toBe(
        completed.body.merchantTotalMinor,
      );
      expect(
        await database.courierLedgerEntry.count({
          where: { orderId: order.id, type: 'COMMISSION_DUE' },
        }),
      ).toBe(1);
    });
  },
);

async function clearOtpState(database: PrismaClient, phones: string[]) {
  await database.otpChallenge.deleteMany({
    where: { phone: { in: phones } },
  });
  if (!process.env.REDIS_URL) return;
  const redis = new Redis(process.env.REDIS_URL);
  const keys = [
    ...(await redis.keys('otp:ip:*')),
    ...(await redis.keys('otp:verify:*')),
    ...phones.map((phone) => `otp:phone:${phone}`),
  ];
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}

async function createEligibleCouriers(
  database: PrismaClient,
  serviceZoneId: string,
  phones: string[],
  runId: string,
) {
  for (const [index, phone] of phones.entries()) {
    const user = await database.user.create({
      data: {
        phone,
        displayName: `Phase 3 race courier ${index}`,
        role: 'COURIER',
        status: 'ACTIVE',
        phoneVerifiedAt: new Date(),
      },
    });
    const courier = await database.courierProfile.create({
      data: {
        userId: user.id,
        fullName: `Phase 3 race courier ${index}`,
        preferredCity: 'Ø¯Ù…ÙŠØ§Ø·',
        verificationStatus: 'APPROVED',
        approvedAt: new Date(),
      },
    });
    const vehicle = await database.vehicle.create({
      data: {
        courierId: courier.id,
        type: 'MOTORCYCLE',
        plateNumber: `P3-${runId.slice(-6)}-${index}`,
        active: true,
      },
    });
    await database.courierDocument.createMany({
      data: requiredCourierDocumentTypes.map((type) => ({
        courierId: courier.id,
        ...(type === 'VEHICLE_LICENSE' ? { vehicleId: vehicle.id } : {}),
        type,
        status: 'APPROVED' as const,
        storageKey: `tests/phase3/${runId}/${index}/${type}.pdf`,
        originalFilename: `${type.toLowerCase()}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 16,
        checksumSha256: `${index}`.padStart(64, '0'),
        expiresAt: new Date('2035-01-01'),
        reviewedAt: new Date(),
        isCurrent: true,
      })),
    });
    await database.courierServiceZone.create({
      data: {
        courierId: courier.id,
        serviceZoneId,
        active: true,
      },
    });
  }
}
