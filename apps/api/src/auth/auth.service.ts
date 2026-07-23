import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ServerEnvironment } from '@wasel/config';
import {
  roleFromDatabase,
  type AuthenticatedUser,
  type AuthTokens,
  type Role,
} from '@wasel/contracts';
import type { PrismaClient, User, UserRole } from '@wasel/database';
import type { OtpProvider } from '@wasel/providers';
import {
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type Redis from 'ioredis';
import { SignJWT } from 'jose';

import { writeAudit } from '../infrastructure/audit.js';
import { databaseRoleByRole } from '../infrastructure/request.js';
import {
  DATABASE,
  ENVIRONMENT,
  OTP_PROVIDER,
  REDIS,
} from '../infrastructure/tokens.js';

const publicRegistrationRoles = new Set<Role>(['merchant_owner', 'courier']);

@Injectable()
export class AuthService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENVIRONMENT) private readonly environment: ServerEnvironment,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  public async requestOtp(
    phone: string,
    ipAddress: string | undefined,
  ): Promise<{
    challengeId: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  }> {
    await Promise.all([
      this.enforceLimit(`otp:ip:${ipAddress ?? 'unknown'}`, 20, 60 * 60),
      this.enforceLimit(`otp:phone:${phone}`, 5, 60 * 60),
    ]);

    const previous = await this.database.otpChallenge.findFirst({
      where: { phone, purpose: 'SIGN_IN' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const cooldownEndsAt =
      (previous?.createdAt.getTime() ?? 0) +
      this.environment.OTP_RESEND_COOLDOWN_SECONDS * 1_000;
    if (
      previous &&
      Date.now() - previous.createdAt.getTime() <
        this.environment.OTP_RESEND_COOLDOWN_SECONDS * 1_000
    ) {
      throw new HttpException(
        `Wait until ${new Date(cooldownEndsAt).toISOString()} before retrying.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const challengeId = randomUUID();
    const user = await this.database.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    const provider = await this.otpProvider.request(
      phone,
      'sign_in',
      this.environment.OTP_MOCK_CODE,
    );
    await this.database.otpChallenge.create({
      data: {
        id: challengeId,
        phone,
        purpose: 'SIGN_IN',
        codeHash: this.otpHash(challengeId, this.environment.OTP_MOCK_CODE),
        provider: 'mock',
        providerRef: provider.providerReference,
        expiresAt: new Date(
          Date.now() + this.environment.OTP_TTL_SECONDS * 1_000,
        ),
        ...(user ? { userId: user.id } : {}),
      },
    });

    return {
      challengeId,
      expiresInSeconds: this.environment.OTP_TTL_SECONDS,
      resendAfterSeconds: this.environment.OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  public async verifyOtp(input: {
    challengeId: string;
    code: string;
    registrationRole?: Role;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    await this.enforceLimit(`otp:verify:${input.challengeId}`, 10, 15 * 60);
    const challenge = await this.database.otpChallenge.findUnique({
      where: { id: input.challengeId },
    });
    const suppliedHash = this.otpHash(input.challengeId, input.code);
    const hashMatches =
      challenge !== null &&
      timingSafeEqual(
        Buffer.from(challenge.codeHash, 'hex'),
        Buffer.from(suppliedHash, 'hex'),
      );
    const invalid =
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= this.environment.OTP_MAX_ATTEMPTS ||
      !hashMatches;

    if (invalid) {
      if (challenge && challenge.consumedAt === null) {
        await this.database.otpChallenge.updateMany({
          where: {
            id: challenge.id,
            attempts: { lt: this.environment.OTP_MAX_ATTEMPTS },
          },
          data: { attempts: { increment: 1 } },
        });
      }
      throw new UnauthorizedException('The OTP is invalid or expired.');
    }

    const existingUser = await this.database.user.findUnique({
      where: { phone: challenge.phone },
    });
    let role: UserRole;
    if (existingUser) {
      role = existingUser.role;
    } else {
      const requestedRole = input.registrationRole ?? 'courier';
      if (!publicRegistrationRoles.has(requestedRole)) {
        throw new ForbiddenException('This role requires an invitation.');
      }
      role = databaseRoleByRole[requestedRole];
    }

    const user = await this.database.$transaction(async (transaction) => {
      const consumed = await transaction.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date(), attempts: { increment: 1 } },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('The OTP was already used.');
      }
      const verified = await transaction.user.upsert({
        where: { phone: challenge.phone },
        update: {
          phoneVerifiedAt: new Date(),
          lastSignedInAt: new Date(),
          status: existingUser?.status === 'PENDING' ? 'ACTIVE' : undefined,
        },
        create: {
          phone: challenge.phone,
          role,
          status: 'ACTIVE',
          phoneVerifiedAt: new Date(),
          lastSignedInAt: new Date(),
        },
      });
      if (verified.status !== 'ACTIVE') {
        throw new ForbiddenException('This account is not active.');
      }
      return verified;
    });

    const tokens = await this.createSession(user, {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { user: this.publicUser(user), tokens };
  }

  public async refresh(
    refreshToken: string,
  ): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const tokenHash = this.tokenHash(refreshToken);
    const session = await this.database.session.findFirst({
      where: {
        OR: [
          { refreshTokenHash: tokenHash },
          { previousRefreshTokenHash: tokenHash },
        ],
      },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('The refresh token is invalid.');
    }
    if (session.previousRefreshTokenHash === tokenHash) {
      await this.database.session.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokedReason: 'refresh_token_reuse',
          version: { increment: 1 },
        },
      });
      throw new UnauthorizedException('Refresh token reuse was detected.');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new ForbiddenException('This account is not active.');
    }

    const nextRefreshToken = this.newRefreshToken();
    const rotated = await this.database.session.updateMany({
      where: {
        id: session.id,
        version: session.version,
        refreshTokenHash: tokenHash,
        revokedAt: null,
      },
      data: {
        previousRefreshTokenHash: tokenHash,
        refreshTokenHash: this.tokenHash(nextRefreshToken),
        lastUsedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (rotated.count !== 1) {
      throw new UnauthorizedException('The refresh token was already rotated.');
    }

    return {
      user: this.publicUser(session.user),
      tokens: {
        accessToken: await this.signAccessToken(session.user, session.id),
        refreshToken: nextRefreshToken,
        accessTokenExpiresInSeconds: this.environment.ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }

  public async logout(userId: string, sessionId: string): Promise<void> {
    await this.database.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: 'logout',
        version: { increment: 1 },
      },
    });
  }

  public async logoutAll(userId: string, actorRole: Role): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: 'logout_all',
          version: { increment: 1 },
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: databaseRoleByRole[actorRole],
        action: 'auth.logout_all',
        entityType: 'User',
        entityId: userId,
      });
    });
  }

  public async me(userId: string): Promise<AuthenticatedUser> {
    const user = await this.database.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return this.publicUser(user);
  }

  private async createSession(
    user: User,
    metadata: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const refreshToken = this.newRefreshToken();
    const session = await this.database.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.tokenHash(refreshToken),
        expiresAt: new Date(
          Date.now() +
            this.environment.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1_000,
        ),
        ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
    });
    return {
      accessToken: await this.signAccessToken(user, session.id),
      refreshToken,
      accessTokenExpiresInSeconds: this.environment.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private async signAccessToken(
    user: User,
    sessionId: string,
  ): Promise<string> {
    return new SignJWT({ sid: sessionId, role: roleFromDatabase(user.role) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer('wasel-api')
      .setAudience('wasel-clients')
      .setIssuedAt()
      .setExpirationTime(`${this.environment.ACCESS_TOKEN_TTL_SECONDS} seconds`)
      .sign(new TextEncoder().encode(this.environment.ACCESS_TOKEN_SECRET));
  }

  private publicUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      role: roleFromDatabase(user.role),
      status: user.status.toLowerCase() as AuthenticatedUser['status'],
      locale: user.locale === 'AR_EG' ? 'ar-EG' : 'en',
    };
  }

  private otpHash(challengeId: string, code: string): string {
    return createHmac('sha256', this.environment.OTP_PEPPER)
      .update(`${challengeId}:${code}`)
      .digest('hex');
  }

  private newRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async enforceLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    if (count > limit) {
      throw new HttpException(
        'Too many requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
