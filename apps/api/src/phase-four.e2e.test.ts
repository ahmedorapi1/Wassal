import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  createDatabaseClient,
  type Prisma,
  type PrismaClient,
} from '@wasel/database';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { RealtimeService } from './realtime/realtime.service.js';

const ids = {
  deliveredOrder: '93000000-0000-4000-8000-000000000002',
  returnAwaitingOrder: '93000000-0000-4000-8000-000000000006',
  courierTwo: '40000000-0000-4000-8000-000000000015',
} as const;

type Session = { authorization: string; accessToken: string };

describe.sequential('Phase 4 operational E2E', () => {
  let app: INestApplication;
  let database: PrismaClient;
  let baseUrl: string;
  let owner: Session;
  let courier: Session;
  let courierTwo: Session;
  let operations: Session;
  let finance: Session;
  let deliveredOrderId: string;
  let returnAwaitingOrderId: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Phase 4 E2E tests.');
    }
    database = createDatabaseClient(process.env.DATABASE_URL);
    ({ deliveredOrderId, returnAwaitingOrderId } = await createMutableFixtures(
      database,
      runId,
    ));
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    app.setGlobalPrefix('api/v1');
    app.get(RealtimeService).attach(app.getHttpServer());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as {
      port: number;
    };
    baseUrl = `http://127.0.0.1:${address.port}`;
    owner = await login('+201001000001', 'MerchantDemo123');
    courier = await login('+201001000013', 'CourierDemo123');
    courierTwo = await login('+201001000015', 'CourierDemo123');
    operations = await login('+201001000004', 'AdminDemo123');
    finance = await login('+201001000006', 'AdminDemo123');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await database?.$disconnect();
  });

  async function login(phone: string, password: string): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password })
      .expect(201);
    const accessToken = response.body.tokens.accessToken as string;
    return {
      accessToken,
      authorization: `Bearer ${accessToken}`,
    };
  }

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseUrl, {
        path: '/api/v1/realtime',
        transports: ['websocket'],
        auth: token ? { token } : {},
        reconnection: false,
      });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Realtime connection timed out.'));
      }, 5_000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('connect_error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        reject(error);
      });
    });
  }

  it('accepts an authenticated socket and rejects an anonymous socket', async () => {
    const socket = await connect(owner.accessToken);
    expect(socket.connected).toBe(true);
    socket.close();
    await expect(connect()).rejects.toThrow(/Authentication failed/i);
  });

  it('blocks commission, records one dispute response, then finalizes once on admin confirmation', async () => {
    const order = await database.deliveryOrder.findUniqueOrThrow({
      where: { id: deliveredOrderId },
    });
    expect(order.status).toBe('DELIVERED');
    expect(
      await database.courierLedgerEntry.count({
        where: { orderId: order.id, type: 'COMMISSION_DUE' },
      }),
    ).toBe(0);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/delivery-disputes`)
      .set('Authorization', owner.authorization)
      .send({
        version: order.version,
        reason: 'CUSTOMER_DID_NOT_RECEIVE',
        note: 'Synthetic Phase 4 dispute.',
      })
      .expect(201);
    expect(created.body.status).toBe('OPEN');
    expect(
      await database.courierLedgerEntry.count({
        where: { orderId: order.id, type: 'COMMISSION_DUE' },
      }),
    ).toBe(0);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/couriers/orders/${order.id}/delivery-dispute/response`)
      .set('Authorization', courier.authorization)
      .send({
        version: created.body.version,
        response: 'Synthetic courier response.',
        paperProofAvailable: false,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/couriers/orders/${order.id}/delivery-dispute/response`)
      .set('Authorization', courier.authorization)
      .send({
        version: response.body.version,
        response: 'A second response must not be accepted.',
        paperProofAvailable: false,
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/delivery-disputes/${created.body.id}/resolve`)
      .set('Authorization', finance.authorization)
      .send({
        version: response.body.version,
        resolution: 'CONFIRM_DELIVERY',
        note: 'Finance cannot resolve this dispute.',
      })
      .expect(403);
    const resolved = await request(app.getHttpServer())
      .post(`/api/v1/admin/delivery-disputes/${created.body.id}/resolve`)
      .set('Authorization', operations.authorization)
      .send({
        version: response.body.version,
        resolution: 'CONFIRM_DELIVERY',
        note: 'Synthetic evidence confirms delivery.',
      })
      .expect(201);
    expect(resolved.body.status).toBe('RESOLVED_DELIVERY_CONFIRMED');
    expect(
      await database.courierLedgerEntry.count({
        where: { orderId: order.id, type: 'COMMISSION_DUE' },
      }),
    ).toBe(1);
  });

  it('confirms a returned order idempotently and creates one commission', async () => {
    const order = await database.deliveryOrder.findUniqueOrThrow({
      where: { id: returnAwaitingOrderId },
    });
    const key = `phase4-return-${runId}`;
    const command = () =>
      request(app.getHttpServer())
        .post(`/api/v1/merchant/orders/${order.id}/confirm-return`)
        .set('Authorization', owner.authorization)
        .set('Idempotency-Key', key)
        .send({ version: order.version, condition: 'INTACT' });
    const first = await command().expect(201);
    const replay = await command().expect(201);
    expect(first.body.id).toBe(replay.body.id);
    expect(first.body.status).toBe('COMPLETED');
    expect(
      await database.courierLedgerEntry.count({
        where: { orderId: order.id, type: 'COMMISSION_DUE' },
      }),
    ).toBe(1);
  });

  it('keeps proof submission non-financial and applies one partial approval transactionally', async () => {
    const start = new Date(
      new Date('2030-01-01T00:00:00.000Z').getTime() +
        (Date.now() % 86_400_000),
    );
    await database.settlementPeriod.create({
      data: {
        courierId: ids.courierTwo,
        periodStart: start,
        periodEnd: new Date(start.getTime() + 7 * 86_400_000),
        dueAt: new Date(start.getTime() + 14 * 86_400_000),
        totalCommissionDueMinor: 2_000,
        remainingAmountMinor: 2_000,
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfkcAAAAASUVORK5CYII=',
      'base64',
    );
    const submitted = await request(app.getHttpServer())
      .post('/api/v1/couriers/payment-proofs')
      .set('Authorization', courierTwo.authorization)
      .set('Idempotency-Key', `phase4-proof-submit-${runId}`)
      .field('amountMinor', '1000')
      .field('method', 'BANK_TRANSFER')
      .field('paidAt', new Date().toISOString())
      .field('externalReference', `P4-${runId}`)
      .attach('file', png, {
        filename: 'receipt.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(submitted.body.status).toBe('PENDING_CONFIRMATION');
    expect(submitted.body.storageKey).toBeUndefined();
    expect(
      await database.externalPaymentRecord.count({
        where: { paymentProof: { id: submitted.body.id } },
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/payment-proofs/${submitted.body.id}/approve`)
      .set('Authorization', operations.authorization)
      .set('Idempotency-Key', `phase4-proof-denied-${runId}`)
      .send({
        version: submitted.body.version,
        approvedAmountMinor: 500,
        reason: 'Operations is not finance.',
      })
      .expect(403);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/admin/payment-proofs/${submitted.body.id}/approve`)
      .set('Authorization', finance.authorization)
      .set('Idempotency-Key', `phase4-proof-approve-${runId}`)
      .send({
        version: submitted.body.version,
        approvedAmountMinor: 500,
        reason: 'Only 5 EGP is visible in the synthetic receipt.',
      })
      .expect(201);
    expect(approved.body.status).toBe('PARTIALLY_APPROVED');
    expect(approved.body.linkedExternalPayment.amountMinor).toBe(500);
    expect(
      await database.externalPaymentRecord.count({
        where: { paymentProof: { id: submitted.body.id } },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .get(`/api/v1/payment-proofs/${submitted.body.id}/file`)
      .set('Authorization', courierTwo.authorization)
      .expect('Cache-Control', 'private, no-store')
      .expect('Content-Type', 'image/png')
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/payment-proofs/${submitted.body.id}/file`)
      .set('Authorization', courier.authorization)
      .expect(403);
  });
});

async function createMutableFixtures(
  database: PrismaClient,
  runId: string,
): Promise<{ deliveredOrderId: string; returnAwaitingOrderId: string }> {
  const deliveredOrderId = await cloneOrder(
    database,
    ids.deliveredOrder,
    'DELIVERED',
    `DEL-${runId}`,
  );
  const returnAwaitingOrderId = await cloneOrder(
    database,
    ids.returnAwaitingOrder,
    'RETURN_AWAITING_MERCHANT_CONFIRMATION',
    `RET-${runId}`,
  );
  return { deliveredOrderId, returnAwaitingOrderId };
}

async function cloneOrder(
  database: PrismaClient,
  sourceOrderId: string,
  status: 'DELIVERED' | 'RETURN_AWAITING_MERCHANT_CONFIRMATION',
  suffix: string,
): Promise<string> {
  const sourceOrder = await database.deliveryOrder.findUniqueOrThrow({
    where: { id: sourceOrderId },
  });
  const sourceQuote = await database.priceQuote.findUniqueOrThrow({
    where: { id: sourceOrder.quoteId },
  });
  const {
    id: _quoteId,
    idempotencyKey: _idempotencyKey,
    requestFingerprint: _requestFingerprint,
    createdAt: _quoteCreatedAt,
    ...quoteBase
  } = sourceQuote;
  const quoteId = randomUUID();
  await database.priceQuote.create({
    data: {
      ...quoteBase,
      id: quoteId,
      status: 'CONSUMED',
      idempotencyKey: `phase4-e2e-quote-${suffix}`,
      requestFingerprint: Buffer.from(suffix)
        .toString('hex')
        .padEnd(64, '0')
        .slice(0, 64),
      customerSnapshot: quoteBase.customerSnapshot as Prisma.InputJsonValue,
      pickupAddressSnapshot:
        quoteBase.pickupAddressSnapshot as Prisma.InputJsonValue,
      dropoffAddressSnapshot:
        quoteBase.dropoffAddressSnapshot as Prisma.InputJsonValue,
      packageSnapshot: quoteBase.packageSnapshot as Prisma.InputJsonValue,
      routeSnapshot: quoteBase.routeSnapshot as Prisma.InputJsonValue,
      breakdown: quoteBase.breakdown as Prisma.InputJsonValue,
      consumedAt: new Date(),
      version: 1,
      createdAt: new Date(),
    },
  });
  const {
    id: _orderId,
    quoteId: _sourceQuoteId,
    orderNumber: _sourceOrderNumber,
    createdAt: _orderCreatedAt,
    updatedAt: _orderUpdatedAt,
    ...orderBase
  } = sourceOrder;
  const orderId = randomUUID();
  await database.deliveryOrder.create({
    data: {
      ...orderBase,
      id: orderId,
      quoteId,
      orderNumber: `WSL-${suffix}`.slice(0, 32),
      status,
      financialFinalizedAt: null,
      completedAt: null,
      completionSource: null,
      returnConfirmedAt: null,
      returnConfirmedById: null,
      returnCondition: null,
      returnConfirmationNote: null,
      customerSnapshot: orderBase.customerSnapshot as Prisma.InputJsonValue,
      pickupAddressSnapshot:
        orderBase.pickupAddressSnapshot as Prisma.InputJsonValue,
      dropoffAddressSnapshot:
        orderBase.dropoffAddressSnapshot as Prisma.InputJsonValue,
      packageSnapshot: orderBase.packageSnapshot as Prisma.InputJsonValue,
      routeSnapshot: orderBase.routeSnapshot as Prisma.InputJsonValue,
      pricingSnapshot: orderBase.pricingSnapshot as Prisma.InputJsonValue,
      ...(status === 'DELIVERED'
        ? {
            deliveredAt: new Date(),
            deliveryDisputeDeadlineAt: new Date(
              Date.now() + 24 * 60 * 60 * 1_000,
            ),
          }
        : {}),
      version: 1,
      createdAt: new Date(),
    },
  });
  return orderId;
}
