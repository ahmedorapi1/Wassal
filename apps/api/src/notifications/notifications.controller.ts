import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import { paginationSchema, z } from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { NotificationsService } from './notifications.service.js';

const listSchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().optional(),
});

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  public constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  public list(@Principal() actor: SessionPrincipal, @Query() query: unknown) {
    return this.notifications.list(actor.userId, parseInput(listSchema, query));
  }

  @Get('unread-count')
  public count(@Principal() actor: SessionPrincipal) {
    return this.notifications.unreadCount(actor.userId);
  }

  @Post(':notificationId/read')
  public read(
    @Principal() actor: SessionPrincipal,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notifications.markRead(actor.userId, notificationId);
  }

  @Post('read-all')
  public readAll(@Principal() actor: SessionPrincipal) {
    return this.notifications.markAllRead(actor.userId);
  }
}
