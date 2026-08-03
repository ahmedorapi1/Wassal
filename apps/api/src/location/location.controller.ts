import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import type { SessionPrincipal } from '@wasel/contracts';
import { coordinatesSchema, z } from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { LocationService } from './location.service.js';

const mapsLinkSchema = z.object({
  url: z.string().trim().url().max(1_000),
});

@Controller('location')
@UseGuards(AuthGuard, RolesGuard)
@Roles('merchant_owner', 'merchant_manager', 'merchant_staff')
export class LocationController {
  public constructor(
    @Inject(LocationService) private readonly location: LocationService,
  ) {}

  @Post('validate')
  public validate(@Body() body: unknown) {
    return this.location.validate(parseInput(coordinatesSchema, body));
  }

  @Post('validate-pickup')
  @Roles('merchant_owner', 'merchant_manager')
  public validatePickup(@Body() body: unknown) {
    return this.location.validatePickup(parseInput(coordinatesSchema, body));
  }

  @Post('resolve-maps-link')
  public resolveMapsLink(
    @Principal() actor: SessionPrincipal,
    @Body() body: unknown,
  ) {
    const input = parseInput(mapsLinkSchema, body);
    return this.location.resolveMapsLink(actor.userId, input.url);
  }
}
