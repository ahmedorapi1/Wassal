import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@wasel/database';

import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';

@Injectable()
export class OperationalSettingsService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
  ) {}

  public current() {
    return this.database.platformOperationalSetting.findFirstOrThrow({
      where: { effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
  }

  public history() {
    return this.database.platformOperationalSetting.findMany({
      orderBy: { version: 'desc' },
    });
  }

  public async update(
    actorId: string,
    input: {
      currentVersion: number;
      deliveryDisputeWindowHours: number;
      returnConfirmationTimeoutHours: number;
      notificationRetentionDays: number;
    },
  ) {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.platformOperationalSetting.findFirst({
        orderBy: { version: 'desc' },
      });
      if (!current || current.version !== input.currentVersion) {
        throw new ConflictException(
          'Operational settings changed. Reload first.',
        );
      }
      const next = await transaction.platformOperationalSetting.create({
        data: {
          deliveryDisputeWindowHours: input.deliveryDisputeWindowHours,
          returnConfirmationTimeoutHours: input.returnConfirmationTimeoutHours,
          notificationRetentionDays: input.notificationRetentionDays,
          operationsTimezone: 'Africa/Cairo',
          effectiveFrom: new Date(),
          version: current.version + 1,
          createdById: actorId,
        },
      });
      await writeAudit(transaction, {
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'operational_settings.version_created',
        entityType: 'PlatformOperationalSetting',
        entityId: next.id,
        before: {
          version: current.version,
          deliveryDisputeWindowHours: current.deliveryDisputeWindowHours,
          returnConfirmationTimeoutHours:
            current.returnConfirmationTimeoutHours,
          notificationRetentionDays: current.notificationRetentionDays,
        },
        after: {
          version: next.version,
          deliveryDisputeWindowHours: next.deliveryDisputeWindowHours,
          returnConfirmationTimeoutHours: next.returnConfirmationTimeoutHours,
          notificationRetentionDays: next.notificationRetentionDays,
        },
      });
      return next;
    });
  }
}
