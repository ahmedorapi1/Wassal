import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  courierDisputeResponseSchema,
  deliveryDisputeReasons,
  deliveryDisputeSchema,
  disputeResolutionSchema,
  returnConfirmationSchema,
  returnOverrideSchema,
  idempotencyHeaderSchema,
  z,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { DeliveryOperationsService } from './delivery-operations.service.js';

@Controller()
@UseGuards(AuthGuard)
export class DeliveryOperationsController {
  public constructor(
    @Inject(DeliveryOperationsService)
    private readonly operations: DeliveryOperationsService,
  ) {}

  @Post('merchant/orders/:orderId/delivery-disputes')
  @UseGuards(RolesGuard)
  @Roles('merchant_owner', 'merchant_manager')
  public createDispute(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ) {
    return this.operations.merchantDispute(
      actor as SessionPrincipal & {
        role: 'merchant_owner' | 'merchant_manager';
      },
      orderId,
      parseInput(deliveryDisputeSchema, body),
    );
  }

  @Get('merchant/orders/:orderId/delivery-dispute')
  @UseGuards(RolesGuard)
  @Roles('merchant_owner', 'merchant_manager')
  public merchantDispute(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
  ) {
    return this.operations.merchantDisputeDetail(actor.userId, orderId);
  }

  @Get('couriers/orders/:orderId/delivery-dispute')
  @UseGuards(RolesGuard)
  @Roles('courier')
  public courierDispute(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
  ) {
    return this.operations.courierDisputeDetail(actor.userId, orderId);
  }

  @Post('couriers/orders/:orderId/delivery-dispute/response')
  @UseGuards(RolesGuard)
  @Roles('courier')
  public courierResponse(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ) {
    return this.operations.courierRespond(
      actor as SessionPrincipal & { role: 'courier' },
      orderId,
      parseInput(courierDisputeResponseSchema, body),
    );
  }

  @Get('admin/delivery-disputes')
  @UseGuards(PermissionsGuard)
  @Permissions('delivery_dispute:read')
  public disputes(@Query() query: unknown) {
    return this.operations.adminDisputes(
      parseInput(
        z.object({
          status: z
            .enum([
              'OPEN',
              'COURIER_RESPONDED',
              'RESOLVED_DELIVERY_CONFIRMED',
              'RESOLVED_NOT_DELIVERED',
              'RESOLVED_RETURN_REQUIRED',
              'CANCELLED_BY_ADMIN',
            ])
            .optional(),
          merchantId: z.string().uuid().optional(),
          courierId: z.string().uuid().optional(),
          reason: z.enum(deliveryDisputeReasons).optional(),
          overdueOnly: z.coerce.boolean().optional(),
        }),
        query,
      ),
    );
  }

  @Get('admin/delivery-disputes/:disputeId')
  @UseGuards(PermissionsGuard)
  @Permissions('delivery_dispute:read')
  public dispute(@Param('disputeId') disputeId: string) {
    return this.operations.adminDispute(disputeId);
  }

  @Post('admin/delivery-disputes/:disputeId/resolve')
  @UseGuards(PermissionsGuard)
  @Permissions('delivery_dispute:resolve')
  public resolve(
    @Principal() actor: SessionPrincipal,
    @Param('disputeId') disputeId: string,
    @Body() body: unknown,
  ) {
    return this.operations.resolveDispute(
      actor as SessionPrincipal & {
        role: 'operations_admin' | 'super_admin';
      },
      disputeId,
      parseInput(disputeResolutionSchema, body),
    );
  }

  @Post('merchant/orders/:orderId/confirm-return')
  @UseGuards(RolesGuard)
  @Roles('merchant_owner', 'merchant_manager')
  public confirmReturn(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.operations.confirmReturn(
      actor as SessionPrincipal & {
        role: 'merchant_owner' | 'merchant_manager';
      },
      orderId,
      parseInput(returnConfirmationSchema, body),
      parseInput(idempotencyHeaderSchema, key),
    );
  }

  @Post('admin/orders/:orderId/confirm-return')
  @UseGuards(PermissionsGuard)
  @Permissions('return:override')
  public overrideReturn(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    const input = parseInput(returnOverrideSchema, body);
    return this.operations.confirmReturn(
      actor as SessionPrincipal & {
        role: 'operations_admin' | 'super_admin';
      },
      orderId,
      input,
      parseInput(idempotencyHeaderSchema, key),
      input.reason,
    );
  }
}
