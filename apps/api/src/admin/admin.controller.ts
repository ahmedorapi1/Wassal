import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import { z } from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { AdminService } from './admin.service.js';

const filterSchema = z.object({
  status: z
    .enum([
      'DRAFT',
      'INCOMPLETE',
      'PENDING_REVIEW',
      'CHANGES_REQUESTED',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
    ])
    .optional(),
  search: z.string().trim().max(160).optional(),
});
const versionSchema = z.object({
  version: z.coerce.number().int().positive(),
});
const reasonSchema = versionSchema.extend({
  reason: z.string().trim().min(3).max(1_000),
});
const userStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED']),
});

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('operations_admin', 'super_admin')
export class AdminController {
  public constructor(
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  @Get('couriers')
  public couriers(@Query() query: unknown) {
    return this.admin.couriers(parseInput(filterSchema, query));
  }

  @Get('couriers/:courierId')
  public courier(@Param('courierId') courierId: string) {
    return this.admin.courier(courierId);
  }

  @Get('couriers/:courierId/documents')
  public documents(@Param('courierId') courierId: string) {
    return this.admin.documents(courierId);
  }

  @Post('couriers/:courierId/documents/:documentId/approve')
  public approveDocument(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    return this.admin.reviewDocument(this.actor(actor), courierId, documentId, {
      action: 'approve',
      ...parseInput(versionSchema, body),
    });
  }

  @Post('couriers/:courierId/documents/:documentId/reject')
  public rejectDocument(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    return this.admin.reviewDocument(this.actor(actor), courierId, documentId, {
      action: 'reject',
      ...parseInput(reasonSchema, body),
    });
  }

  @Post('couriers/:courierId/documents/:documentId/request-replacement')
  public requestReplacement(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    return this.admin.reviewDocument(this.actor(actor), courierId, documentId, {
      action: 'request_replacement',
      ...parseInput(reasonSchema, body),
    });
  }

  @Post('couriers/:courierId/approve')
  public approveCourier(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Body() body: unknown,
  ) {
    return this.transition(actor, courierId, 'approve', versionSchema, body);
  }

  @Post('couriers/:courierId/reject')
  public rejectCourier(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Body() body: unknown,
  ) {
    return this.transition(actor, courierId, 'reject', reasonSchema, body);
  }

  @Post('couriers/:courierId/suspend')
  public suspendCourier(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Body() body: unknown,
  ) {
    return this.transition(actor, courierId, 'suspend', reasonSchema, body);
  }

  @Post('couriers/:courierId/reactivate')
  public reactivateCourier(
    @Principal() actor: SessionPrincipal,
    @Param('courierId') courierId: string,
    @Body() body: unknown,
  ) {
    return this.transition(actor, courierId, 'reactivate', versionSchema, body);
  }

  @Get('couriers/:courierId/verification-history')
  public history(@Param('courierId') courierId: string) {
    return this.admin.verificationHistory(courierId);
  }

  @Get('couriers/:courierId/audit-log')
  public audit(@Param('courierId') courierId: string) {
    return this.admin.auditLog(courierId);
  }

  @Get('merchants')
  public merchants() {
    return this.admin.merchants();
  }

  @Get('merchants/:merchantId')
  public merchant(@Param('merchantId') merchantId: string) {
    return this.admin.merchant(merchantId);
  }

  @Post('users/:userId/status')
  public userStatus(
    @Principal() actor: SessionPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateUserStatus(
      this.actor(actor),
      userId,
      parseInput(userStatusSchema, body),
    );
  }

  private transition(
    actor: SessionPrincipal,
    courierId: string,
    action: 'approve' | 'reject' | 'suspend' | 'reactivate',
    schema: typeof versionSchema | typeof reasonSchema,
    body: unknown,
  ) {
    return this.admin.transitionCourier(this.actor(actor), courierId, {
      action,
      ...parseInput(schema, body),
    });
  }

  private actor(principal: SessionPrincipal): {
    userId: string;
    role: 'operations_admin' | 'super_admin';
  } {
    return {
      userId: principal.userId,
      role:
        principal.role === 'super_admin' ? 'super_admin' : 'operations_admin',
    };
  }
}
