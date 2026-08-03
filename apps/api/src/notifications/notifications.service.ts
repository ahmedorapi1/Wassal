import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@wasel/database';

import { DATABASE } from '../infrastructure/tokens.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type DatabaseLike = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class NotificationsService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  public async create(
    database: DatabaseLike,
    input: {
      recipientUserId: string;
      type: string;
      title: string;
      body: string;
      deduplicationKey: string;
      relatedEntityType?: string;
      relatedEntityId?: string;
      deepLink?: string;
      metadata?: Prisma.InputJsonValue;
      expiresAt?: Date;
    },
  ) {
    const notification = await database.notification.upsert({
      where: { deduplicationKey: input.deduplicationKey },
      update: {},
      create: input,
    });
    this.realtime.publish(
      `user:${input.recipientUserId}`,
      'notification.created',
      {
        notificationId: notification.id,
        notificationType: notification.type,
      },
    );
    return notification;
  }

  public async list(
    userId: string,
    input: { page: number; pageSize: number; unreadOnly?: boolean },
  ) {
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
    const [items, total] = await Promise.all([
      this.database.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.notification.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  public async unreadCount(userId: string) {
    return {
      count: await this.database.notification.count({
        where: {
          recipientUserId: userId,
          readAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
    };
  }

  public async markRead(userId: string, notificationId: string) {
    const result = await this.database.notification.updateMany({
      where: { id: notificationId, recipientUserId: userId },
      data: { readAt: new Date() },
    });
    if (result.count !== 1) {
      throw new NotFoundException('Notification was not found.');
    }
    return { success: true };
  }

  public async markAllRead(userId: string) {
    const result = await this.database.notification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, updated: result.count };
  }
}
