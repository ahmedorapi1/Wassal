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
  createOrderSchema,
  idempotencyHeaderSchema,
  merchantCancellationSchema,
  paginationSchema,
  quoteRequestSchema,
  retryCourierSearchSchema,
  z,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { OrdersService } from './orders.service.js';

const orderFiltersSchema = paginationSchema.extend({
  status: z
    .enum([
      'DRAFT',
      'QUOTED',
      'SEARCHING_COURIER',
      'NO_COURIER_AVAILABLE',
      'NO_COURIER_AVAILABLE_FINAL',
      'COURIER_ASSIGNED',
      'COURIER_ARRIVING_PICKUP',
      'AT_PICKUP',
      'PICKED_UP',
      'IN_TRANSIT',
      'AT_DROPOFF',
      'DELIVERED',
      'DELIVERY_FAILED',
      'RETURNING_TO_STORE',
      'RETURNED',
      'COMPLETED',
      'CANCELLED',
    ])
    .optional(),
  search: z.string().trim().max(160).optional(),
});

const quoteValidationFieldMessages: Record<
  string,
  { field: string; message: string }
> = {
  customer: {
    field: 'customerName',
    message: 'بيانات العميل غير صحيحة.',
  },
  'customer.name': {
    field: 'customerName',
    message: 'اسم العميل غير صحيح.',
  },
  'customer.phone': {
    field: 'customerPhone',
    message: 'رقم الموبايل غير صحيح.',
  },
  dropoff: {
    field: 'location',
    message: 'بيانات عنوان التسليم غير صحيحة.',
  },
  'dropoff.addressLine': {
    field: 'addressLine',
    message: 'العنوان النصي غير صحيح.',
  },
  'dropoff.contactName': {
    field: 'customerName',
    message: 'اسم العميل غير صحيح.',
  },
  'dropoff.contactPhone': {
    field: 'customerPhone',
    message: 'رقم الموبايل غير صحيح.',
  },
  'dropoff.latitude': {
    field: 'location',
    message: 'إحداثيات موقع التسليم غير صحيحة.',
  },
  'dropoff.longitude': {
    field: 'location',
    message: 'إحداثيات موقع التسليم غير صحيحة.',
  },
  'package.declaredValueMinor': {
    field: 'declaredValue',
    message: 'القيمة المعلنة غير صحيحة.',
  },
  'package.itemDescription': {
    field: 'itemDescription',
    message: 'وصف الطلب غير صحيح.',
  },
  'package.packageCount': {
    field: 'packageCount',
    message: 'عدد الطرود غير صحيح.',
  },
  'package.prohibitedItemsConfirmed': {
    field: 'prohibitedItemsConfirmed',
    message: 'يجب تأكيد خلو الطلب من المواد المحظورة.',
  },
  'package.weightGrams': {
    field: 'weightKg',
    message: 'وزن الطلب غير صحيح.',
  },
  storeId: {
    field: 'storeId',
    message: 'الفرع المحدد غير صالح.',
  },
};

@Controller('orders')
@UseGuards(AuthGuard, RolesGuard)
@Roles('merchant_owner', 'merchant_manager', 'merchant_staff')
export class OrdersController {
  public constructor(
    @Inject(OrdersService) private readonly ordersService: OrdersService,
  ) {}

  @Post('quotes')
  public createQuote(
    @Principal() actor: SessionPrincipal,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    return this.ordersService.createQuote(
      actor.userId,
      parseInput(quoteRequestSchema, body, {
        message: 'بيانات الطلب غير صحيحة.',
        fieldForIssue: (issue) =>
          quoteValidationFieldMessages[issue.path.map(String).join('.')],
      }),
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Get('quotes/:quoteId')
  public quote(
    @Principal() actor: SessionPrincipal,
    @Param('quoteId') quoteId: string,
  ) {
    return this.ordersService.quote(actor.userId, quoteId);
  }

  @Post('quotes/:quoteId/recalculate')
  public recalculateQuote(
    @Principal() actor: SessionPrincipal,
    @Param('quoteId') quoteId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    return this.ordersService.recalculateQuote(
      actor.userId,
      quoteId,
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Post()
  public createOrder(
    @Principal() actor: SessionPrincipal,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    const input = parseInput(createOrderSchema, body);
    return this.ordersService.createOrder(
      { userId: actor.userId, role: actor.role },
      input.quoteId,
      input.quoteVersion,
      input.locationReviewed,
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Get()
  public orders(@Principal() actor: SessionPrincipal, @Query() query: unknown) {
    return this.ordersService.orders(
      actor.userId,
      parseInput(orderFiltersSchema, query),
    );
  }

  @Get(':orderId/events')
  public events(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.events(actor.userId, orderId);
  }

  @Get(':orderId')
  public order(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.order(actor.userId, orderId);
  }

  @Post(':orderId/cancel')
  @Roles('merchant_owner', 'merchant_manager')
  public cancel(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    return this.ordersService.cancelMerchant(
      { userId: actor.userId, role: actor.role },
      orderId,
      parseInput(merchantCancellationSchema, body),
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }

  @Post(':orderId/retry-courier-search')
  @Roles('merchant_owner', 'merchant_manager')
  public retryCourierSearch(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    const input = parseInput(retryCourierSearchSchema, body);
    return this.ordersService.retryCourierSearch(
      { userId: actor.userId, role: actor.role },
      orderId,
      input.version,
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }
}
