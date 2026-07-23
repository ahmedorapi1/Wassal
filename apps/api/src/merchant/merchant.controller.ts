import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  coordinatesInputSchema,
  egyptianPhoneSchema,
  merchantRoleSchema,
  workingHoursSchema,
  z,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { MerchantService } from './merchant.service.js';

const merchantSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(160),
});
const updateMerchantSchema = merchantSchema.partial().extend({
  version: z.number().int().positive(),
});
const storeBaseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: egyptianPhoneSchema.optional(),
  addressLine: z.string().trim().min(5).max(500),
  area: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  workingHours: workingHoursSchema.optional(),
  active: z.boolean().optional(),
});
const storeSchema = storeBaseSchema.extend(coordinatesInputSchema.shape);
const updateStoreSchema = storeBaseSchema
  .extend({
    latitude: coordinatesInputSchema.shape.latitude.optional(),
    longitude: coordinatesInputSchema.shape.longitude.optional(),
  })
  .partial()
  .extend({
    version: z.number().int().positive(),
  });
const staffSchema = z.object({
  phone: egyptianPhoneSchema,
  displayName: z.string().trim().min(2).max(160),
  role: merchantRoleSchema,
});
const updateStaffSchema = z.object({
  role: merchantRoleSchema.optional(),
  active: z.boolean().optional(),
  version: z.number().int().positive(),
});

@Controller('merchants')
@UseGuards(AuthGuard, RolesGuard)
@Roles('merchant_owner', 'merchant_manager', 'merchant_staff')
export class MerchantController {
  public constructor(
    @Inject(MerchantService) private readonly merchants: MerchantService,
  ) {}

  @Post()
  @Roles('merchant_owner')
  public create(@Principal() user: SessionPrincipal, @Body() body: unknown) {
    return this.merchants.create(user.userId, parseInput(merchantSchema, body));
  }

  @Get('current')
  public current(@Principal() user: SessionPrincipal) {
    return this.merchants.current(user.userId);
  }

  @Patch('current')
  @Roles('merchant_owner', 'merchant_manager')
  public updateCurrent(
    @Principal() user: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.merchants.updateCurrent(
      user.userId,
      parseInput(updateMerchantSchema, body),
    );
  }

  @Post('current/stores')
  @Roles('merchant_owner', 'merchant_manager')
  public createStore(
    @Principal() user: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.merchants.createStore(
      user.userId,
      parseInput(storeSchema, body),
    );
  }

  @Get('current/stores')
  public stores(@Principal() user: SessionPrincipal) {
    return this.merchants.stores(user.userId);
  }

  @Get('current/stores/:storeId')
  public store(
    @Principal() user: SessionPrincipal,
    @Param('storeId') storeId: string,
  ) {
    return this.merchants.store(user.userId, storeId);
  }

  @Patch('current/stores/:storeId')
  @Roles('merchant_owner', 'merchant_manager')
  public updateStore(
    @Principal() user: SessionPrincipal,
    @Param('storeId') storeId: string,
    @Body() body: unknown,
  ) {
    return this.merchants.updateStore(
      user.userId,
      storeId,
      parseInput(updateStoreSchema, body),
    );
  }

  @Post('current/staff')
  @Roles('merchant_owner', 'merchant_manager')
  public addStaff(@Principal() user: SessionPrincipal, @Body() body: unknown) {
    return this.merchants.addStaff(user.userId, parseInput(staffSchema, body));
  }

  @Get('current/staff')
  public staff(@Principal() user: SessionPrincipal) {
    return this.merchants.staff(user.userId);
  }

  @Patch('current/staff/:membershipId')
  @Roles('merchant_owner', 'merchant_manager')
  public updateStaff(
    @Principal() user: SessionPrincipal,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    return this.merchants.updateStaff(
      user.userId,
      membershipId,
      parseInput(updateStaffSchema, body),
    );
  }
}
