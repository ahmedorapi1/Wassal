import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import { phaseThreePaginationSchema } from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { FinanceService } from './finance.service.js';

@Controller('couriers')
@UseGuards(AuthGuard, PermissionsGuard)
export class CourierFinanceController {
  public constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}

  @Get('account/summary')
  @Permissions('courier_account:read')
  public summary(@Principal() actor: SessionPrincipal) {
    return this.finance.courierSummary(actor.userId);
  }

  @Get('account/entries')
  @Permissions('courier_account:read')
  public entries(
    @Principal() actor: SessionPrincipal,
    @Query() query: unknown,
  ) {
    return this.finance.courierEntries(
      actor.userId,
      parseInput(phaseThreePaginationSchema, query),
    );
  }

  @Get('settlements')
  @Permissions('courier_settlement:read')
  public settlements(
    @Principal() actor: SessionPrincipal,
    @Query() query: unknown,
  ) {
    return this.finance.courierSettlements(
      actor.userId,
      parseInput(phaseThreePaginationSchema, query),
    );
  }

  @Get('settlements/:settlementId')
  @Permissions('courier_settlement:read')
  public settlement(
    @Principal() actor: SessionPrincipal,
    @Param('settlementId') settlementId: string,
  ) {
    return this.finance.courierSettlement(actor.userId, settlementId);
  }
}
