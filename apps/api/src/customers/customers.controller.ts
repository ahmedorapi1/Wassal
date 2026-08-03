import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import {
  addressInputSchema,
  addressUpdateSchema,
  customerInputSchema,
  customerUpdateSchema,
  z,
} from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { CustomersService } from './customers.service.js';

const customerFiltersSchema = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

@Controller('merchant/customers')
@UseGuards(AuthGuard, RolesGuard)
@Roles('merchant_owner', 'merchant_manager', 'merchant_staff')
export class CustomersController {
  public constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  @Post()
  public create(@Principal() actor: SessionPrincipal, @Body() body: unknown) {
    return this.customers.create(
      actor.userId,
      parseInput(customerInputSchema, body),
    );
  }

  @Get()
  public list(@Principal() actor: SessionPrincipal, @Query() query: unknown) {
    return this.customers.list(
      actor.userId,
      parseInput(customerFiltersSchema, query),
    );
  }

  @Get(':customerId')
  public get(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.get(actor.userId, customerId);
  }

  @Patch(':customerId')
  public update(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
    @Body() body: unknown,
  ) {
    return this.customers.update(
      actor.userId,
      customerId,
      parseInput(customerUpdateSchema, body),
    );
  }

  @Post(':customerId/archive')
  @Roles('merchant_owner', 'merchant_manager')
  public archive(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.setArchived(actor.userId, customerId, true);
  }

  @Post(':customerId/restore')
  @Roles('merchant_owner', 'merchant_manager')
  public restore(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.setArchived(actor.userId, customerId, false);
  }

  @Post(':customerId/addresses')
  public createAddress(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
    @Body() body: unknown,
  ) {
    return this.customers.createAddress(
      actor.userId,
      customerId,
      parseInput(addressInputSchema, body),
    );
  }

  @Get(':customerId/addresses')
  public addresses(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.addresses(actor.userId, customerId);
  }

  @Patch(':customerId/addresses/:addressId')
  public updateAddress(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
    @Body() body: unknown,
  ) {
    return this.customers.updateAddress(
      actor.userId,
      customerId,
      addressId,
      parseInput(addressUpdateSchema, body),
    );
  }

  @Post(':customerId/addresses/:addressId/archive')
  public archiveAddress(
    @Principal() actor: SessionPrincipal,
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
  ) {
    return this.customers.archiveAddress(actor.userId, customerId, addressId);
  }
}
