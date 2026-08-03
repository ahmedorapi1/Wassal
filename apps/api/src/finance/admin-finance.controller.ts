import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  adminCourierAccountsQuerySchema,
  courierAdjustmentSchema,
  externalPaymentSchema,
  financialSettingsUpdateSchema,
  idempotencyHeaderSchema,
  settlementCloseSchema,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { FinanceService } from './finance.service.js';

@Controller('admin')
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminFinanceController {
  public constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}

  @Get('financial-settings')
  @Permissions('finance_settings:read')
  public settings() {
    return this.finance.financialSettings();
  }

  @Patch('financial-settings')
  @Permissions('finance_settings:update')
  public updateSettings(
    @Principal() actor: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.finance.updateFinancialSettings(
      actor,
      parseInput(financialSettingsUpdateSchema, body),
    );
  }

  @Get('courier-accounts')
  @Permissions('courier_accounts:read')
  public accounts(@Query() query: unknown) {
    return this.finance.courierAccounts(
      parseInput(adminCourierAccountsQuerySchema, query),
    );
  }

  @Get('finance/zones')
  @Permissions('courier_accounts:read')
  public zoneDashboard() {
    return this.finance.zoneFinanceDashboard();
  }

  @Get('finance/zones/:serviceZoneId')
  @Permissions('courier_accounts:read')
  public zoneDetail(
    @Principal() actor: SessionPrincipal,
    @Param('serviceZoneId') serviceZoneId: string,
  ) {
    return this.finance.zoneFinanceDetail(actor, serviceZoneId);
  }

  @Get('couriers/:courierId/account')
  @Permissions('courier_accounts:read')
  public account(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
  ) {
    return this.finance.adminCourierAccount(actor, courierId);
  }

  @Get('settlements')
  @Permissions('settlements:read')
  public settlements(@Query() query: unknown) {
    return this.finance.adminSettlements(
      parseInput(adminCourierAccountsQuerySchema, query),
    );
  }

  @Get('settlements/:settlementId')
  @Permissions('settlements:read')
  public settlement(@Param('settlementId') settlementId: string) {
    return this.finance.adminSettlement(settlementId);
  }

  @Post('settlements/:settlementId/close')
  @Permissions('settlements:close')
  @HttpCode(200)
  public closeSettlement(
    @Principal() actor: SessionPrincipal,
    @Param('settlementId') settlementId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    const input = parseInput(settlementCloseSchema, body);
    return this.finance.closeSettlement(
      actor,
      settlementId,
      input.version,
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Post('couriers/:courierId/external-payments')
  @Permissions('external_payments:create')
  public externalPayment(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    return this.finance.recordExternalPayment(
      actor,
      courierId,
      parseInput(externalPaymentSchema, body),
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Post('external-payments/:paymentId/reverse')
  @Permissions('external_payments:reverse')
  @HttpCode(200)
  public reversePayment(
    @Principal() actor: SessionPrincipal,
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    return this.finance.reverseExternalPayment(
      actor,
      paymentId,
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Post('couriers/:courierId/adjustments')
  @Permissions('adjustments:create')
  public adjustment(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    return this.finance.createAdjustment(
      actor,
      courierId,
      parseInput(courierAdjustmentSchema, body),
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Get('settlements/:settlementId/export.csv')
  @Permissions('financial_exports:create')
  public async exportSettlement(
    @Param('settlementId') settlementId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.finance.settlementCsv(settlementId);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="skka-settlement-${settlementId}.csv"`,
    );
    return csv;
  }
}
