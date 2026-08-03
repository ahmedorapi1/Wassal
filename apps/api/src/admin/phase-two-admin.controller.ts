import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  adminCancellationSchema,
  idempotencyHeaderSchema,
  paginationSchema,
  z,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  PhaseTwoAdminService,
  type PricingInput,
} from './phase-two-admin.service.js';

const coordinate = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const ring = z.array(coordinate).min(4);
const geometrySchema = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(ring).min(1)).min(1),
  }),
]);
const zoneFields = {
  name: z.string().trim().min(2).max(160),
  countryCode: z.string().length(2).default('EG'),
  governorate: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  centerLatitude: z.number().min(-90).max(90).optional(),
  centerLongitude: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().positive().max(500).optional(),
  geometry: geometrySchema.optional(),
  allowedPickup: z.boolean().default(true),
  allowedDropoff: z.boolean().default(true),
  maximumRouteDistanceMeters: z.number().int().positive(),
  priority: z.number().int().default(0),
} as const;
const zoneSchema = z.object(zoneFields).superRefine((value, context) => {
  const hasCircle =
    value.centerLatitude !== undefined &&
    value.centerLongitude !== undefined &&
    value.radiusKm !== undefined;
  if (!hasCircle && !value.geometry) {
    context.addIssue({
      code: 'custom',
      message: 'اختر مركز المنطقة ونصف قطرها على الخريطة.',
    });
  }
});
const zoneUpdateSchema = z
  .object({
    name: zoneFields.name.optional(),
    countryCode: z.string().length(2).optional(),
    governorate: zoneFields.governorate.optional(),
    city: zoneFields.city.optional(),
    centerLatitude: zoneFields.centerLatitude,
    centerLongitude: zoneFields.centerLongitude,
    radiusKm: zoneFields.radiusKm,
    geometry: zoneFields.geometry,
    allowedPickup: z.boolean().optional(),
    allowedDropoff: z.boolean().optional(),
    maximumRouteDistanceMeters:
      zoneFields.maximumRouteDistanceMeters.optional(),
    priority: z.number().int().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    version: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    const circleValues = [
      value.centerLatitude,
      value.centerLongitude,
      value.radiusKm,
    ];
    const supplied = circleValues.filter((item) => item !== undefined).length;
    if (supplied > 0 && supplied < circleValues.length) {
      context.addIssue({
        code: 'custom',
        message: 'يجب إرسال مركز المنطقة ونصف القطر معًا.',
      });
    }
  });
const weightBandSchema = z.object({
  upToGrams: z.number().int().positive(),
  surchargeMinor: z.number().int().nonnegative(),
});
const pricingSchema = z
  .object({
    ruleFamilyKey: z.string().trim().max(100).optional(),
    countryCode: z.string().length(2).default('EG'),
    governorate: z.string().trim().min(2).max(120).default('تُشتق من المنطقة'),
    city: z.string().trim().min(2).max(120).default('تُشتق من المنطقة'),
    serviceZoneId: z.string().uuid(),
    vehicleType: z.literal('MOTORCYCLE').default('MOTORCYCLE'),
    currency: z.literal('EGP').default('EGP'),
    baseFeeMinor: z.number().int().nonnegative(),
    includedDistanceMeters: z.number().int().nonnegative(),
    perKilometerMinor: z.number().int().nonnegative(),
    minimumFeeMinor: z.number().int().nonnegative().default(0),
    maximumDistanceMeters: z.number().int().positive().default(1),
    smallPackageSurchargeMinor: z.number().int().nonnegative().default(0),
    mediumPackageSurchargeMinor: z.number().int().nonnegative().default(0),
    largePackageSurchargeMinor: z.number().int().nonnegative().default(0),
    weightBands: z
      .array(weightBandSchema)
      .min(1)
      .default([{ upToGrams: 25_000, surchargeMinor: 0 }]),
    fragileSurchargeMinor: z.number().int().nonnegative().default(0),
    thermalBagSurchargeMinor: z.number().int().nonnegative().default(0),
    waitingFeePerMinuteMinor: z.number().int().nonnegative().default(0),
    returnTripBaseMinor: z.number().int().nonnegative().default(0),
    returnTripPercentageBasisPoints: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .default(7_000),
    commissionType: z.enum(['PERCENTAGE', 'FIXED']),
    commissionValue: z.number().int().nonnegative(),
    taxBasisPoints: z.number().int().min(0).max(10_000).default(0),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional(),
    priority: z.number().int().default(0),
  })
  .superRefine((value, context) => {
    if (
      value.commissionType === 'PERCENTAGE' &&
      value.commissionValue > 10_000
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commissionValue'],
        message: 'نسبة العمولة يجب أن تكون بين 0% و100%.',
      });
    }
  });
const orderFiltersSchema = paginationSchema.extend({
  orderNumber: z.string().trim().max(32).optional(),
  merchantId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  customerPhone: z.string().trim().max(20).optional(),
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
      'DELIVERY_DISPUTED',
      'DELIVERY_FAILED',
      'RETURNING_TO_STORE',
      'RETURN_AWAITING_MERCHANT_CONFIRMATION',
      'RETURNED',
      'COMPLETED',
      'CANCELLED',
    ])
    .optional(),
  statusGroup: z
    .enum([
      'NEW',
      'AVAILABLE',
      'ACCEPTED',
      'PICKING_UP',
      'IN_DELIVERY',
      'COMPLETED_GROUP',
      'RETURNED_GROUP',
      'CANCELLED_GROUP',
      'DISPUTED',
    ])
    .optional(),
  serviceZoneId: z.string().uuid().optional(),
  courierId: z.string().uuid().optional(),
  cancellationReason: z.string().trim().max(80).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
});

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('support_agent', 'operations_admin', 'finance_admin', 'super_admin')
export class PhaseTwoAdminController {
  public constructor(
    @Inject(PhaseTwoAdminService)
    private readonly admin: PhaseTwoAdminService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
  ) {}

  @Get('phase-2/dashboard')
  public dashboard() {
    return this.admin.dashboard();
  }

  @Get('service-zones')
  public zones() {
    return this.admin.serviceZones();
  }

  @Get('service-zones/:zoneId')
  public zone(@Param('zoneId') zoneId: string) {
    return this.admin.serviceZone(zoneId);
  }

  @Post('service-zones')
  @Roles('super_admin')
  public createZone(
    @Principal() actor: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.admin.createServiceZone(actor, parseInput(zoneSchema, body));
  }

  @Patch('service-zones/:zoneId')
  @Roles('super_admin')
  public updateZone(
    @Principal() actor: SessionPrincipal,
    @Param('zoneId') zoneId: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateServiceZone(
      actor,
      zoneId,
      parseInput(zoneUpdateSchema, body),
    );
  }

  @Post('service-zones/:zoneId/activate')
  @Roles('super_admin')
  public activateZone(
    @Principal() actor: SessionPrincipal,
    @Param('zoneId') zoneId: string,
  ) {
    return this.admin.setServiceZoneStatus(actor, zoneId, 'ACTIVE');
  }

  @Post('service-zones/:zoneId/deactivate')
  @Roles('super_admin')
  public deactivateZone(
    @Principal() actor: SessionPrincipal,
    @Param('zoneId') zoneId: string,
  ) {
    return this.admin.setServiceZoneStatus(actor, zoneId, 'INACTIVE');
  }

  @Delete('service-zones/:zoneId')
  @Roles('super_admin')
  public deleteZone(
    @Principal() actor: SessionPrincipal,
    @Param('zoneId') zoneId: string,
  ) {
    return this.admin.deleteServiceZone(actor, zoneId);
  }

  @Get('pricing-rules')
  public pricingRules(@Query('includeArchived') includeArchived?: string) {
    return this.admin.pricingRules(includeArchived === 'true');
  }

  @Get('pricing-rules/:ruleId')
  public pricingRule(@Param('ruleId') ruleId: string) {
    return this.admin.pricingRule(ruleId);
  }

  @Post('pricing-rules')
  @Roles('super_admin')
  public createPricing(
    @Principal() actor: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.admin.createPricingRule(
      actor,
      parseInput(pricingSchema, body) as PricingInput,
    );
  }

  @Post('pricing-rules/:ruleId/new-version')
  @Roles('super_admin')
  public newPricingVersion(
    @Principal() actor: SessionPrincipal,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ) {
    return this.admin.newPricingRuleVersion(
      actor,
      ruleId,
      parseInput(pricingSchema.partial(), body) as Partial<PricingInput>,
    );
  }

  @Post('pricing-rules/:ruleId/activate')
  @Roles('super_admin')
  public activatePricing(
    @Principal() actor: SessionPrincipal,
    @Param('ruleId') ruleId: string,
  ) {
    return this.admin.setPricingStatus(actor, ruleId, 'ACTIVE');
  }

  @Post('pricing-rules/:ruleId/deactivate')
  @Roles('super_admin')
  public deactivatePricing(
    @Principal() actor: SessionPrincipal,
    @Param('ruleId') ruleId: string,
  ) {
    return this.admin.setPricingStatus(actor, ruleId, 'INACTIVE');
  }

  @Post('pricing-rules/:ruleId/archive')
  @Roles('super_admin')
  public archivePricing(
    @Principal() actor: SessionPrincipal,
    @Param('ruleId') ruleId: string,
  ) {
    return this.admin.archivePricingRule(actor, ruleId);
  }

  @Delete('pricing-rules/:ruleId')
  @Roles('super_admin')
  public deletePricing(
    @Principal() actor: SessionPrincipal,
    @Param('ruleId') ruleId: string,
  ) {
    return this.admin.deletePricingRule(actor, ruleId);
  }

  @Post('pricing-rules/validate-overlaps')
  @Roles('super_admin')
  public validatePricing(@Body() body: unknown) {
    const input = parseInput(
      z.object({ ruleId: z.string().uuid().optional() }),
      body,
    );
    return this.admin.validatePricingOverlaps(input.ruleId);
  }

  @Get('orders')
  public orders(@Query() query: unknown) {
    return this.admin.orders(parseInput(orderFiltersSchema, query));
  }

  @Get('order-zones')
  public orderZoneDashboard() {
    return this.admin.orderZoneDashboard();
  }

  @Get('order-zones/:serviceZoneId/summary')
  public orderZoneSummary(@Param('serviceZoneId') serviceZoneId: string) {
    return this.admin.orderZoneSummary(serviceZoneId);
  }

  @Get('orders/:orderId/events')
  public orderEvents(@Param('orderId') orderId: string) {
    return this.admin.orderEvents(orderId);
  }

  @Get('orders/:orderId')
  public order(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
  ) {
    return this.admin.order(actor, orderId);
  }

  @Post('orders/:orderId/cancel')
  @Roles('operations_admin', 'super_admin')
  public cancelOrder(
    @Principal() actor: SessionPrincipal,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    return this.ordersService.cancelAdmin(
      actor,
      orderId,
      parseInput(adminCancellationSchema, body),
      parseInput(idempotencyHeaderSchema, idempotencyKey),
    );
  }
}
