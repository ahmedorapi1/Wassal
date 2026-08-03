import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionPrincipal } from '@wasel/contracts';
import type { Response } from 'express';
import { z } from '@wasel/validation';

import { AuthGuard } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { parseInput, Principal } from '../infrastructure/request.js';
import { CourierService } from './courier.service.js';
import { inlineContentDisposition } from './file-response.js';

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  preferredCity: z.string().trim().min(2).max(120).optional(),
  emergencyContactName: z.string().trim().min(2).max(160).optional(),
  emergencyContactPhone: z.string().optional(),
});
const updateProfileSchema = profileSchema.partial().extend({
  emergencyContactName: z.string().trim().min(2).max(160).nullable().optional(),
  emergencyContactPhone: z.string().nullable().optional(),
  version: z.coerce.number().int().positive(),
});
const vehicleSchema = z.object({
  plateNumber: z.string().trim().min(2).max(40),
  manufacturer: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  color: z.string().trim().min(1).max(60).optional(),
});
const updateVehicleSchema = vehicleSchema.partial().extend({
  active: z.boolean().optional(),
  version: z.coerce.number().int().positive(),
});
const documentSchema = z.object({
  type: z.enum([
    'NATIONAL_ID_FRONT',
    'NATIONAL_ID_BACK',
    'DRIVER_LICENSE',
    'VEHICLE_LICENSE',
    'PROFILE_PHOTO',
  ]),
  documentNumber: z.string().trim().min(2).max(100).optional(),
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  vehicleId: z.string().uuid().optional(),
});

@Controller('couriers')
@UseGuards(AuthGuard, RolesGuard)
export class CourierController {
  public constructor(
    @Inject(CourierService) private readonly couriers: CourierService,
  ) {}

  @Post('profile')
  @Roles('courier')
  public createProfile(
    @Principal() user: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.couriers.createProfile(
      user.userId,
      parseInput(profileSchema, body),
    );
  }

  @Get('profile')
  @Roles('courier')
  public profile(@Principal() user: SessionPrincipal) {
    return this.couriers.profile(user.userId);
  }

  @Patch('profile')
  @Roles('courier')
  public updateProfile(
    @Principal() user: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.couriers.updateProfile(
      user.userId,
      parseInput(updateProfileSchema, body),
    );
  }

  @Post('vehicles')
  @Roles('courier')
  public addVehicle(
    @Principal() user: SessionPrincipal,
    @Body() body: unknown,
  ) {
    return this.couriers.addVehicle(
      user.userId,
      parseInput(vehicleSchema, body),
    );
  }

  @Get('vehicles')
  @Roles('courier')
  public vehicles(@Principal() user: SessionPrincipal) {
    return this.couriers.vehicles(user.userId);
  }

  @Patch('vehicles/:vehicleId')
  @Roles('courier')
  public updateVehicle(
    @Principal() user: SessionPrincipal,
    @Param('vehicleId') vehicleId: string,
    @Body() body: unknown,
  ) {
    return this.couriers.updateVehicle(
      user.userId,
      vehicleId,
      parseInput(updateVehicleSchema, body),
    );
  }

  @Post('documents')
  @Roles('courier')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5_242_880, files: 1 },
    }),
  )
  public uploadDocument(
    @Principal() user: SessionPrincipal,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.couriers.uploadDocument(
      user.userId,
      parseInput(documentSchema, body),
      file,
    );
  }

  @Get('documents')
  @Roles('courier')
  public documents(@Principal() user: SessionPrincipal) {
    return this.couriers.documents(user.userId);
  }

  @Get('documents/:documentId/file')
  @Roles('courier', 'operations_admin', 'super_admin')
  public async documentFile(
    @Principal() user: SessionPrincipal,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.couriers.documentFile(
      user.userId,
      user.role,
      documentId,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      inlineContentDisposition(file.filename),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Length', String(file.bytes.byteLength));
    response.send(Buffer.from(file.bytes));
  }

  @Post('documents/:documentId/replacement')
  @Roles('courier')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5_242_880, files: 1 },
    }),
  )
  public replaceDocument(
    @Principal() user: SessionPrincipal,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.couriers.uploadDocument(
      user.userId,
      parseInput(documentSchema, body),
      file,
      documentId,
    );
  }

  @Post('submit-for-review')
  @Roles('courier')
  public submit(@Principal() user: SessionPrincipal) {
    return this.couriers.submitForReview(user.userId);
  }

  @Get('verification-status')
  @Roles('courier')
  public status(@Principal() user: SessionPrincipal) {
    return this.couriers.verificationStatus(user.userId);
  }
}
