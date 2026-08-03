import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { roles } from '@wasel/contracts';
import {
  coordinatesInputSchema,
  egyptianPhoneSchema,
  otpCodeSchema,
  passwordLoginSchema,
  passwordSchema,
  requestOtpSchema,
  z,
} from '@wasel/validation';
import type { Request } from 'express';
import type { SessionPrincipal } from '@wasel/contracts';

import {
  clientMetadata,
  parseInput,
  Principal,
} from '../infrastructure/request.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: otpCodeSchema,
  registrationRole: z.enum(roles).optional(),
});
const refreshSchema = z.object({ refreshToken: z.string().min(32) });
const registrationSchema = z.object({
  phone: requestOtpSchema.shape.phone,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(160),
  accountType: z.enum(['courier', 'merchant']),
  legalName: z.string().trim().min(2).max(200).optional(),
});
const merchantRegistrationSchema = z
  .object({
    ownerFullName: z.string().trim().min(3).max(160),
    phone: egyptianPhoneSchema,
    password: passwordSchema,
    passwordConfirmation: z.string().min(1).max(128),
    business: z.object({
      name: z.string().trim().min(2).max(200),
      category: z.string().trim().min(2).max(120),
      contactPhone: egyptianPhoneSchema,
      email: z.string().trim().email().max(320).optional(),
    }),
    firstBranch: z
      .object({
        name: z.string().trim().min(2).max(160),
        phone: egyptianPhoneSchema,
        governorate: z.string().trim().min(2).max(120),
        city: z.string().trim().min(2).max(120),
        area: z.string().trim().min(2).max(120),
        street: z.string().trim().min(2).max(240),
        addressDetails: z.string().trim().min(5).max(500),
        addressLine: z.string().trim().min(5).max(500),
        sourceMapsUrl: z.string().trim().url().max(1_000).optional(),
      })
      .extend(coordinatesInputSchema.shape),
  })
  .superRefine((input, context) => {
    if (input.password !== input.passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'كلمتا المرور غير متطابقتين.',
      });
    }
  });
const merchantMapsLinkSchema = z.object({
  url: z.string().trim().url().max(1_000),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

@Controller()
export class AuthController {
  public constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/request-otp')
  public requestOtp(@Body() body: unknown, @Req() request: Request) {
    const { phone } = parseInput(requestOtpSchema, body);
    return this.auth.requestOtp(phone, request.ip);
  }

  @Post('auth/verify-otp')
  public verifyOtp(@Body() body: unknown, @Req() request: Request) {
    const input = parseInput(verifySchema, body);
    return this.auth.verifyOtp({ ...input, ...clientMetadata(request) });
  }

  @Post('auth/refresh')
  public refresh(@Body() body: unknown) {
    const { refreshToken } = parseInput(refreshSchema, body);
    return this.auth.refresh(refreshToken);
  }

  @Post('auth/login')
  public login(@Body() body: unknown, @Req() request: Request) {
    return this.auth.passwordLogin({
      ...parseInput(passwordLoginSchema, body),
      ...clientMetadata(request),
    });
  }

  @Post('auth/register')
  public register(@Body() body: unknown) {
    return this.auth.registerPilot(parseInput(registrationSchema, body));
  }

  @Get('auth/merchant-registration/config')
  public merchantRegistrationConfig() {
    return this.auth.merchantRegistrationConfig();
  }

  @Post('auth/merchant-registration/location/validate')
  public validateMerchantRegistrationLocation(
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.auth.validateMerchantRegistrationLocation(
      parseInput(coordinatesInputSchema, body),
      request.ip,
    );
  }

  @Post('auth/merchant-registration/location/resolve-maps-link')
  public resolveMerchantRegistrationMapsLink(
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(merchantMapsLinkSchema, body);
    return this.auth.resolveMerchantRegistrationMapsLink(input.url, request.ip);
  }

  @Post('auth/merchant-registration')
  public registerMerchant(@Body() body: unknown, @Req() request: Request) {
    return this.auth.registerMerchantPilot(
      parseInput(merchantRegistrationSchema, body),
      clientMetadata(request),
    );
  }

  @Post('auth/change-password')
  @UseGuards(AuthGuard)
  public changePassword(
    @Principal() principal: SessionPrincipal,
    @Body() body: unknown,
  ) {
    const input = parseInput(changePasswordSchema, body);
    return this.auth.changePassword(
      principal.userId,
      input.currentPassword,
      input.newPassword,
    );
  }

  @Post('admin/users/:userId/reset-password')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('operations_admin', 'super_admin')
  public resetPassword(
    @Principal() principal: SessionPrincipal,
    @Param('userId') userId: string,
  ) {
    return this.auth.adminResetPassword(principal, userId);
  }

  @Post('auth/logout')
  @UseGuards(AuthGuard)
  public async logout(@Principal() principal: SessionPrincipal) {
    await this.auth.logout(principal.userId, principal.sessionId);
    return { success: true };
  }

  @Post('auth/logout-all')
  @UseGuards(AuthGuard)
  public async logoutAll(@Principal() principal: SessionPrincipal) {
    await this.auth.logoutAll(principal.userId, principal.role);
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  public me(@Principal() principal: SessionPrincipal) {
    return this.auth.me(principal.userId);
  }
}
