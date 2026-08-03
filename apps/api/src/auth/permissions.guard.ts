import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@wasel/contracts';

import type { AuthenticatedRequest } from '../infrastructure/request.js';
import { PERMISSIONS_METADATA } from './permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<readonly Permission[]>(
        PERMISSIONS_METADATA,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (required.length === 0) return true;
    const { principal } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (
      !required.every((permission) => hasPermission(principal.role, permission))
    ) {
      throw new ForbiddenException(
        'Your role does not have the required permission.',
      );
    }
    return true;
  }
}
