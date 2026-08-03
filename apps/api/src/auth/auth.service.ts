import {
  BadRequestException,
  ConflictException,
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
import { normalizeEgyptianPhone } from '@wasel/validation';
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
import { LocationService } from '../location/location.service.js';
import { hashPassword, temporaryPassword, verifyPassword } from './password.js';

const publicRegistrationRoles = new Set<Role>(['merchant_owner', 'courier']);

@Injectable()
export class AuthService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENVIRONMENT) private readonly environment: ServerEnvironment,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
    @Inject(LocationService) private readonly location: LocationService,
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
    if (!['ACTIVE', 'PENDING'].includes(session.user.status)) {
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

  public async passwordLogin(input: {
    phone: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{
    user: AuthenticatedUser;
    tokens: AuthTokens;
    forcePasswordChange: boolean;
  }> {
    const phone = normalizeEgyptianPhone(input.phone);
    await Promise.all([
      this.enforceLimit(
        `login:ip:${input.ipAddress ?? 'unknown'}`,
        30,
        15 * 60,
      ),
      this.enforceLimit(`login:phone:${phone}`, 10, 15 * 60),
    ]);
    const user = await this.database.user.findUnique({ where: { phone } });
    const valid =
      user?.passwordHash &&
      (!user.lockedUntil || user.lockedUntil <= new Date()) &&
      (await verifyPassword(input.password, user.passwordHash));
    if (!user || !valid) {
      if (user) {
        const failures = user.failedLoginAttempts + 1;
        const lock = failures >= 5;
        await this.database.$transaction(async (transaction) => {
          await transaction.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: lock ? 0 : failures,
              lockedUntil: lock
                ? new Date(Date.now() + 15 * 60 * 1_000)
                : user.lockedUntil,
            },
          });
          if (lock) {
            await writeAudit(transaction, {
              actorId: user.id,
              actorRole: user.role,
              action: 'auth.login_temporarily_locked',
              entityType: 'User',
              entityId: user.id,
              metadata: { repeatedFailures: 5 },
            });
          }
        });
      }
      throw new UnauthorizedException(
        'The phone number or password is invalid.',
      );
    }
    if (!['ACTIVE', 'PENDING'].includes(user.status)) {
      throw new UnauthorizedException(
        'The phone number or password is invalid.',
      );
    }
    const active = await this.database.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastSignedInAt: new Date(),
      },
    });
    return {
      user: this.publicUser(active),
      tokens: await this.createSession(active, input),
      forcePasswordChange: active.forcePasswordChange,
    };
  }

  public async registerPilot(input: {
    phone: string;
    password: string;
    displayName: string;
    accountType: 'courier' | 'merchant';
    legalName?: string;
  }) {
    if (input.accountType === 'merchant') {
      throw new ForbiddenException(
        'استخدم نموذج إنشاء حساب التاجر الذي يتضمن بيانات النشاط والفرع الأول.',
      );
    }
    const phone = normalizeEgyptianPhone(input.phone);
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            phone,
            passwordHash,
            passwordChangedAt: new Date(),
            displayName: input.displayName,
            role: input.accountType === 'courier' ? 'COURIER' : 'OWNER',
            status: 'PENDING',
          },
        });
        if (input.accountType === 'courier') {
          await transaction.courierProfile.create({
            data: {
              userId: user.id,
              fullName: input.displayName,
              verificationStatus: 'INCOMPLETE',
            },
          });
        } else {
          const merchant = await transaction.merchant.create({
            data: {
              legalName: input.legalName ?? input.displayName,
              displayName: input.displayName,
              status: 'PENDING',
            },
          });
          await transaction.merchantMembership.create({
            data: {
              merchantId: merchant.id,
              userId: user.id,
              role: 'OWNER',
              active: true,
            },
          });
        }
        await writeAudit(transaction, {
          actorId: user.id,
          actorRole: user.role,
          action: 'auth.pilot_registration_submitted',
          entityType: 'User',
          entityId: user.id,
          metadata: { accountType: input.accountType },
        });
        return { id: user.id, status: 'pending_review' as const };
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ForbiddenException('Registration could not be completed.');
      }
      throw error;
    }
  }

  public merchantRegistrationConfig() {
    return {
      enabled: this.environment.MERCHANT_PILOT_REGISTRATION_ENABLED,
    };
  }

  public async validateMerchantRegistrationLocation(
    point: { latitude: number; longitude: number },
    ipAddress: string | undefined,
  ) {
    this.requireMerchantRegistrationEnabled();
    await this.location.enforcePublicMerchantLocationLimit(ipAddress);
    return this.location.validatePickup(point);
  }

  public async resolveMerchantRegistrationMapsLink(
    value: string,
    ipAddress: string | undefined,
  ) {
    this.requireMerchantRegistrationEnabled();
    return this.location.resolvePublicMerchantMapsLink(ipAddress, value);
  }

  public async registerMerchantPilot(
    input: {
      ownerFullName: string;
      phone: string;
      password: string;
      passwordConfirmation: string;
      business: {
        name: string;
        category: string;
        contactPhone: string;
        email?: string;
      };
      firstBranch: {
        name: string;
        phone: string;
        governorate: string;
        city: string;
        area: string;
        street: string;
        addressDetails: string;
        addressLine: string;
        sourceMapsUrl?: string;
        latitude: number;
        longitude: number;
      };
    },
    metadata: { ipAddress?: string; userAgent?: string },
  ) {
    this.requireMerchantRegistrationEnabled();
    const phone = normalizeEgyptianPhone(input.phone);
    const contactPhone = normalizeEgyptianPhone(input.business.contactPhone);
    const branchPhone = normalizeEgyptianPhone(input.firstBranch.phone);
    await Promise.all([
      this.enforceLimit(
        `merchant-registration:ip:${metadata.ipAddress ?? 'unknown'}`,
        5,
        60 * 60,
      ),
      this.enforceLimit(
        `merchant-registration:phone:${phone}`,
        3,
        24 * 60 * 60,
      ),
    ]);

    const validation = await this.location.validatePickup({
      latitude: input.firstBranch.latitude,
      longitude: input.firstBranch.longitude,
    });
    const serviceZone = validation.serviceZone;
    if (!validation.supported || !serviceZone) {
      throw new BadRequestException(
        'موقع الفرع خارج نطاقات الاستلام النشطة حالياً.',
      );
    }
    if (await this.database.user.findUnique({ where: { phone } })) {
      throw new ConflictException(
        'تعذر إنشاء الحساب بهذا الرقم. راجع البيانات أو سجّل الدخول.',
      );
    }

    const passwordHash = await hashPassword(input.password);
    try {
      return await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            phone,
            passwordHash,
            passwordChangedAt: new Date(),
            displayName: input.ownerFullName,
            role: 'OWNER',
            status: 'PENDING',
          },
        });
        const merchant = await transaction.merchant.create({
          data: {
            legalName: input.business.name,
            displayName: input.business.name,
            businessCategory: input.business.category,
            contactPhone,
            contactEmail: input.business.email?.trim().toLowerCase() || null,
            status: 'PENDING',
          },
        });
        await transaction.merchantMembership.create({
          data: {
            merchantId: merchant.id,
            userId: user.id,
            role: 'OWNER',
            active: true,
          },
        });
        const branch = await transaction.store.create({
          data: {
            merchantId: merchant.id,
            name: input.firstBranch.name,
            phone: branchPhone,
            addressLine: input.firstBranch.addressLine,
            governorate: input.firstBranch.governorate,
            city: input.firstBranch.city,
            area: input.firstBranch.area,
            street: input.firstBranch.street,
            addressDetails: input.firstBranch.addressDetails,
            status: 'ACTIVE',
          },
        });
        await transaction.$executeRaw`
          UPDATE "Store"
          SET "location" = ST_SetSRID(
            ST_MakePoint(
              ${input.firstBranch.longitude},
              ${input.firstBranch.latitude}
            ),
            4326
          )::geography
          WHERE "id" = ${branch.id}::uuid
        `;
        await writeAudit(transaction, {
          actorRole: 'OWNER',
          action: 'merchant.pilot_registration_submitted',
          entityType: 'Merchant',
          entityId: merchant.id,
          metadata: {
            ownerUserId: user.id,
            serviceZoneId: serviceZone.id,
            firstBranchId: branch.id,
            sourceMapsUrl: input.firstBranch.sourceMapsUrl ?? null,
          },
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });
        return {
          id: user.id,
          merchantId: merchant.id,
          status: 'pending_review' as const,
        };
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'تعذر إنشاء الحساب بهذا الرقم. راجع البيانات أو سجّل الدخول.',
        );
      }
      throw error;
    }
  }

  public async changePassword(
    userId: string,
    currentPassword: string,
    nextPassword: string,
  ) {
    const user = await this.database.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (
      !user.passwordHash ||
      !(await verifyPassword(currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('The current password is invalid.');
    }
    const passwordHash = await hashPassword(nextPassword);
    await this.database.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          forcePasswordChange: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: 'password_changed',
          version: { increment: 1 },
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: user.role,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: userId,
      });
    });
    return { success: true, sessionsRevoked: true };
  }

  public async adminResetPassword(
    actor: { userId: string; role: Role },
    targetUserId: string,
  ) {
    const generated = temporaryPassword();
    const passwordHash = await hashPassword(generated);
    await this.database.$transaction(async (transaction) => {
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: targetUserId },
      });
      await transaction.user.update({
        where: { id: targetUserId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          forcePasswordChange: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await transaction.session.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedReason: 'admin_password_reset',
          version: { increment: 1 },
        },
      });
      await writeAudit(transaction, {
        actorId: actor.userId,
        actorRole: databaseRoleByRole[actor.role],
        action: 'auth.password_reset_by_admin',
        entityType: 'User',
        entityId: user.id,
      });
    });
    return {
      temporaryPassword: generated,
      forcePasswordChange: true,
      sessionsRevoked: true,
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

  private requireMerchantRegistrationEnabled(): void {
    if (!this.environment.MERCHANT_PILOT_REGISTRATION_ENABLED) {
      throw new ForbiddenException(
        'تسجيل التجار الجدد غير متاح حالياً. تواصل مع فريق سِكّة.',
      );
    }
  }
}
