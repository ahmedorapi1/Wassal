import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@wasel/contracts';

import type { AuthenticatedRequest } from '../infrastructure/request.js';
import { ROLES_METADATA } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles =
      this.reflector.getAllAndOverride<readonly Role[]>(ROLES_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (roles.length === 0) return true;
    const { principal } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!roles.includes(principal.role)) {
      throw new ForbiddenException('Your role cannot perform this action.');
    }
    return true;
  }
}
