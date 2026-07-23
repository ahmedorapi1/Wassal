import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { roleFromDatabase } from '@wasel/contracts';
import type { PrismaClient } from '@wasel/database';
import { jwtVerify } from 'jose';

import type { AuthenticatedRequest } from '../infrastructure/request.js';
import { DATABASE, ENVIRONMENT } from '../infrastructure/tokens.js';

type AuthEnvironment = {
  ACCESS_TOKEN_SECRET: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(ENVIRONMENT) private readonly environment: AuthEnvironment,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication is required.');
    }

    try {
      const { payload } = await jwtVerify(
        authorization.slice(7),
        new TextEncoder().encode(this.environment.ACCESS_TOKEN_SECRET),
        { issuer: 'wasel-api', audience: 'wasel-clients' },
      );
      const userId = payload.sub;
      const sessionId = payload.sid;
      if (typeof userId !== 'string' || typeof sessionId !== 'string') {
        throw new Error('Invalid claims.');
      }
      const session = await this.database.session.findFirst({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE' },
        },
        include: { user: true },
      });
      if (!session) throw new Error('Inactive session.');
      request.principal = {
        userId,
        sessionId,
        role: roleFromDatabase(session.user.role),
      };
      return true;
    } catch {
      throw new UnauthorizedException(
        'The access token is invalid or expired.',
      );
    }
  }
}
