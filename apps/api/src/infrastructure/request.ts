import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Role, SessionPrincipal } from '@wasel/contracts';
import type { z } from '@wasel/validation';
import type { Request } from 'express';

export type AuthenticatedRequest = Request & {
  principal: SessionPrincipal;
};

export const Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionPrincipal =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: 'validation_failed',
      message: 'The request data is invalid.',
      details: result.error.issues,
    });
  }
  return result.data;
}

export function clientMetadata(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const userAgent = request.get('user-agent');
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
  };
}

export type DatabaseRole =
  | 'OWNER'
  | 'MANAGER'
  | 'STAFF'
  | 'COURIER'
  | 'SUPPORT'
  | 'OPERATIONS_ADMIN'
  | 'FINANCE_ADMIN'
  | 'SUPER_ADMIN';

export const databaseRoleByRole: Record<Role, DatabaseRole> = {
  merchant_owner: 'OWNER',
  merchant_manager: 'MANAGER',
  merchant_staff: 'STAFF',
  courier: 'COURIER',
  support_agent: 'SUPPORT',
  operations_admin: 'OPERATIONS_ADMIN',
  finance_admin: 'FINANCE_ADMIN',
  super_admin: 'SUPER_ADMIN',
};
