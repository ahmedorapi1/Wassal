import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { roleFromDatabase, type Role } from '@wasel/contracts';
import type { PrismaClient } from '@wasel/database';
import type Redis from 'ioredis';
import { jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';

import { DATABASE, ENVIRONMENT, REDIS } from '../infrastructure/tokens.js';

export const workerRealtimeChannel = 'wasel:realtime:v1';

type RealtimeEnvironment = {
  ACCESS_TOKEN_SECRET: string;
  CORS_ORIGINS: string;
  NODE_ENV: string;
};

export type RealtimeEnvelope = {
  id: string;
  type: string;
  version: 1;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
};

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private server?: Server;
  private subscriber?: Redis;

  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(ENVIRONMENT) private readonly environment: RealtimeEnvironment,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  public attach(httpServer: HttpServer): void {
    if (this.server) return;
    const configuredOrigins = this.environment.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    this.server = new Server(httpServer, {
      path: '/api/v1/realtime',
      cors: {
        origin:
          this.environment.NODE_ENV === 'production' ? configuredOrigins : true,
      },
      transports: ['websocket', 'polling'],
      serveClient: false,
    });
    this.server.use(async (socket, next) => {
      try {
        const token =
          typeof socket.handshake.auth.token === 'string'
            ? socket.handshake.auth.token
            : undefined;
        if (!token) throw new Error('Missing token.');
        const { payload } = await jwtVerify(
          token,
          new TextEncoder().encode(this.environment.ACCESS_TOKEN_SECRET),
          { issuer: 'wasel-api', audience: 'wasel-clients' },
        );
        if (
          typeof payload.sub !== 'string' ||
          typeof payload.sid !== 'string'
        ) {
          throw new Error('Invalid claims.');
        }
        const session = await this.database.session.findFirst({
          where: {
            id: payload.sid,
            userId: payload.sub,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            user: { status: { in: ['ACTIVE', 'PENDING'] } },
          },
          include: {
            user: {
              include: {
                merchantMemberships: {
                  where: { active: true },
                  select: { merchantId: true },
                },
                courierProfile: {
                  select: {
                    id: true,
                    serviceZones: {
                      where: { active: true },
                      select: { serviceZoneId: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (!session) throw new Error('Inactive session.');
        socket.data.userId = session.userId;
        socket.data.role = roleFromDatabase(session.user.role);
        socket.data.rooms = this.roomsForPrincipal({
          userId: session.userId,
          role: roleFromDatabase(session.user.role),
          merchantIds: session.user.merchantMemberships.map(
            (membership) => membership.merchantId,
          ),
          courierId: session.user.courierProfile?.id,
          serviceZoneIds:
            session.user.courierProfile?.serviceZones.map(
              (zone) => zone.serviceZoneId,
            ) ?? [],
        });
        next();
      } catch {
        next(new Error('Authentication failed.'));
      }
    });
    this.server.on('connection', (socket) => {
      const rooms = socket.data.rooms as string[];
      void socket.join(rooms);
      socket.emit(
        'realtime.ready',
        this.envelope('realtime.ready', {
          rooms: rooms.filter((room) => room.startsWith('user:')),
          reconciliationRequired: true,
        }),
      );
      socket.on('reconcile', () => {
        socket.emit(
          'realtime.reconcile',
          this.envelope('realtime.reconcile', {
            reconciliationRequired: true,
          }),
        );
      });
    });
    void this.subscribeToWorkerEvents();
  }

  public roomsForPrincipal(input: {
    userId: string;
    role: Role;
    merchantIds: readonly string[];
    courierId?: string;
    serviceZoneIds: readonly string[];
  }): string[] {
    const rooms = [`user:${input.userId}`];
    for (const merchantId of input.merchantIds) {
      rooms.push(`merchant:${merchantId}`);
    }
    if (input.role === 'courier' && input.courierId) {
      rooms.push(`courier:${input.courierId}`);
      for (const zoneId of input.serviceZoneIds) {
        rooms.push(`service-zone:${zoneId}`);
      }
    }
    if (
      [
        'support_agent',
        'operations_admin',
        'finance_admin',
        'super_admin',
      ].includes(input.role)
    ) {
      rooms.push(`admin:${input.role}`);
    }
    return rooms;
  }

  public publish(
    room: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): RealtimeEnvelope {
    const event = this.envelope(type, payload);
    this.server?.to(room).emit(type, event);
    return event;
  }

  public async onModuleDestroy(): Promise<void> {
    this.server?.close();
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = undefined;
    }
  }

  private async subscribeToWorkerEvents(): Promise<void> {
    if (this.subscriber) return;
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('message', (channel, raw) => {
      if (channel !== workerRealtimeChannel) return;
      try {
        const message = JSON.parse(raw) as {
          room?: unknown;
          type?: unknown;
          payload?: unknown;
        };
        if (
          typeof message.room === 'string' &&
          typeof message.type === 'string' &&
          message.payload !== null &&
          typeof message.payload === 'object' &&
          !Array.isArray(message.payload)
        ) {
          this.publish(
            message.room,
            message.type,
            message.payload as Readonly<Record<string, unknown>>,
          );
        }
      } catch {
        // Ignore malformed cross-process messages; authenticated clients can
        // always reconcile against the API state.
      }
    });
    await subscriber.subscribe(workerRealtimeChannel);
  }

  private envelope(
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): RealtimeEnvelope {
    return {
      id: randomUUID(),
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }
}
