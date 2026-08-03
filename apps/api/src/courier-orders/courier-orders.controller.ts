import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  courierAvailableOrdersQuerySchema,
  courierCancellationSchema,
  deliveryFailureSchema,
  idempotencyHeaderSchema,
  versionedOrderCommandSchema,
  z,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import {
  CourierOrdersService,
  type CourierLifecycleAction,
} from './courier-orders.service.js';

@Controller('couriers/orders')
@UseGuards(AuthGuard, PermissionsGuard)
export class CourierOrdersController {
  public constructor(
    @Inject(CourierOrdersService)
    private readonly courierOrders: CourierOrdersService,
  ) {}

  @Get('available')
  @Permissions('courier_marketplace:read')
  public available(
    @Principal() actor: SessionPrincipal,
    @Query() query: unknown,
  ) {
    return this.courierOrders.available(
      actor.userId,
      parseInput(courierAvailableOrdersQuerySchema, query),
    );
  }

  @Get('available/:orderId')
  @Permissions('courier_marketplace:read')
  public availableOrder(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
  ) {
    return this.courierOrders.availableOrder(actor.userId, orderId);
  }

  @Post(':orderId/accept')
  @Permissions('courier_order:accept')
  public accept(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    const input = parseInput(versionedOrderCommandSchema, body);
    return this.courierOrders.accept(
      actor,
      orderId,
      input.version,
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Get('current')
  @Permissions('courier_assigned_order:read')
  public current(@Principal() actor: SessionPrincipal) {
    return this.courierOrders.current(actor.userId);
  }

  @Get('history')
  @Permissions('courier_assigned_order:read')
  public history(
    @Principal() actor: SessionPrincipal,
    @Query() query: unknown,
  ) {
    return this.courierOrders.history(
      actor.userId,
      parseInput(courierAvailableOrdersQuerySchema, query),
    );
  }

  @Post(':orderId/arriving-pickup')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public arrivingPickup(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'arriving-pickup', key, body);
  }

  @Post(':orderId/arrived-pickup')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public arrivedPickup(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'arrived-pickup', key, body);
  }

  @Post(':orderId/picked-up')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public pickedUp(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'picked-up', key, body);
  }

  @Post(':orderId/in-transit')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public inTransit(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'in-transit', key, body);
  }

  @Post(':orderId/arrived-dropoff')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public arrivedDropoff(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'arrived-dropoff', key, body);
  }

  @Post(':orderId/delivered')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public delivered(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const input = parseInput(
      versionedOrderCommandSchema.extend({
        note: z.string().trim().max(2_000).optional(),
      }),
      body,
    );
    return this.courierOrders.transition(
      actor,
      orderId,
      'delivered',
      input,
      parseInput(idempotencyHeaderSchema, key),
    );
  }

  @Post(':orderId/delivery-failed')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public deliveryFailed(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const input = parseInput(deliveryFailureSchema, body);
    return this.courierOrders.transition(
      actor,
      orderId,
      'delivery-failed',
      {
        version: input.version,
        failureReason: input.reason,
        note: input.note,
      },
      parseInput(idempotencyHeaderSchema, key),
    );
  }

  @Post(':orderId/returning-to-store')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public returningToStore(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'returning-to-store', key, body);
  }

  @Post(':orderId/returned')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public returned(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.lifecycle(actor, orderId, 'returned', key, body);
  }

  @Post(':orderId/cancel')
  @Permissions('courier_lifecycle:update')
  @HttpCode(200)
  public cancel(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.courierOrders.cancelBeforePickup(
      actor,
      orderId,
      parseInput(courierCancellationSchema, body),
      parseInput(idempotencyHeaderSchema, key),
    );
  }

  private lifecycle(
    actor: SessionPrincipal,
    orderId: string,
    action: CourierLifecycleAction,
    key: unknown,
    body: unknown,
  ) {
    const input = parseInput(versionedOrderCommandSchema, body);
    return this.courierOrders.transition(
      actor,
      orderId,
      action,
      input,
      parseInput(idempotencyHeaderSchema, key),
    );
  }
}
