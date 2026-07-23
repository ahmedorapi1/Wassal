import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { roles } from '@wasel/contracts';
import { otpCodeSchema, requestOtpSchema, z } from '@wasel/validation';
import type { Request } from 'express';
import type { SessionPrincipal } from '@wasel/contracts';

import {
  clientMetadata,
  parseInput,
  Principal,
} from '../infrastructure/request.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: otpCodeSchema,
  registrationRole: z.enum(roles).optional(),
});
const refreshSchema = z.object({ refreshToken: z.string().min(32) });

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
