import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import { operationalSettingSchema, z } from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { OperationalSettingsService } from './operational-settings.service.js';

@Controller('admin/operational-settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class OperationalSettingsController {
  public constructor(
    @Inject(OperationalSettingsService)
    private readonly settings: OperationalSettingsService,
  ) {}

  @Get()
  @Permissions('operational_settings:read')
  public current() {
    return this.settings.current();
  }

  @Get('history')
  @Permissions('operational_settings:read')
  public history() {
    return this.settings.history();
  }

  @Patch()
  @Permissions('operational_settings:update')
  public update(@Principal() actor: SessionPrincipal, @Body() body: unknown) {
    return this.settings.update(
      actor.userId,
      parseInput(
        operationalSettingSchema.extend({
          currentVersion: z.number().int().positive(),
        }),
        body,
      ),
    );
  }
}
