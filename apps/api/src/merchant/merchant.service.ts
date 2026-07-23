import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, PrismaClient, UserRole } from '@wasel/database';
import { normalizeEgyptianPhone } from '@wasel/validation';

import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';

type StoreInput = {
  name: string;
  phone?: string;
  addressLine: string;
  area: string;
  city: string;
  latitude: number;
  longitude: number;
  workingHours?: Prisma.InputJsonValue;
  active?: boolean;
};

type MerchantRole = 'merchant_owner' | 'merchant_manager' | 'merchant_staff';

const merchantDatabaseRole: Record<MerchantRole, UserRole> = {
  merchant_owner: 'OWNER',
  merchant_manager: 'MANAGER',
  merchant_staff: 'STAFF',
};

@Injectable()
export class MerchantService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
  ) {}

  public async create(
    userId: string,
    input: { legalName: string; displayName: string },
  ) {
    const existing = await this.database.merchantMembership.findFirst({
      where: { userId, active: true },
    });
    if (existing)
      throw new ConflictException('You already belong to a merchant.');

    return this.database.$transaction(async (transaction) => {
      const merchant = await transaction.merchant.create({
        data: { ...input, status: 'ACTIVE' },
      });
      await transaction.user.update({
        where: { id: userId },
        data: { role: 'OWNER', displayName: input.displayName },
      });
      await transaction.merchantMembership.create({
        data: { merchantId: merchant.id, userId, role: 'OWNER' },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: 'OWNER',
        action: 'merchant.created',
        entityType: 'Merchant',
        entityId: merchant.id,
      });
      return merchant;
    });
  }

  public async current(userId: string) {
    const membership = await this.membership(userId);
    return {
      ...membership.merchant,
      membership: {
        id: membership.id,
        role: membership.role,
        active: membership.active,
      },
    };
  }

  public async updateCurrent(
    userId: string,
    input: { displayName?: string; legalName?: string; version: number },
  ) {
    const membership = await this.membership(userId);
    this.requireMembershipRole(membership.role, ['OWNER', 'MANAGER']);
    const { version, ...data } = input;
    await this.database.$transaction(async (transaction) => {
      const updated = await transaction.merchant.updateMany({
        where: { id: membership.merchantId, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Merchant was updated.');
      }
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: membership.role,
        action: 'merchant.updated',
        entityType: 'Merchant',
        entityId: membership.merchantId,
      });
    });
    return this.current(userId);
  }

  public async createStore(userId: string, input: StoreInput) {
    const membership = await this.membership(userId);
    this.requireMembershipRole(membership.role, ['OWNER', 'MANAGER']);
    const store = await this.database.$transaction(async (transaction) => {
      const created = await transaction.store.create({
        data: {
          merchantId: membership.merchantId,
          name: input.name,
          ...(input.phone
            ? { phone: normalizeEgyptianPhone(input.phone) }
            : {}),
          addressLine: input.addressLine,
          area: input.area,
          city: input.city,
          ...(input.workingHours ? { workingHours: input.workingHours } : {}),
          status: input.active === false ? 'INACTIVE' : 'ACTIVE',
        },
      });
      await transaction.$executeRaw`
        UPDATE "Store"
        SET "location" = ST_SetSRID(
          ST_MakePoint(${input.longitude}, ${input.latitude}),
          4326
        )::geography
        WHERE "id" = ${created.id}::uuid
      `;
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: membership.role,
        action: 'store.created',
        entityType: 'Store',
        entityId: created.id,
      });
      return created;
    });
    return this.storeById(membership.merchantId, store.id);
  }

  public async stores(userId: string) {
    const membership = await this.membership(userId);
    return this.database.$queryRaw<
      Array<{
        id: string;
        merchantId: string;
        name: string;
        phone: string | null;
        addressLine: string;
        area: string;
        city: string;
        workingHours: Prisma.JsonValue;
        status: string;
        version: number;
        latitude: number | null;
        longitude: number | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT
        "id", "merchantId", "name", "phone", "addressLine", "area", "city",
        "workingHours", "status", "version", "createdAt", "updatedAt",
        ST_Y("location"::geometry) AS "latitude",
        ST_X("location"::geometry) AS "longitude"
      FROM "Store"
      WHERE "merchantId" = ${membership.merchantId}::uuid
      ORDER BY "createdAt" ASC
    `;
  }

  public async store(userId: string, storeId: string) {
    const membership = await this.membership(userId);
    return this.storeById(membership.merchantId, storeId);
  }

  public async updateStore(
    userId: string,
    storeId: string,
    input: Partial<StoreInput> & { version: number },
  ) {
    const membership = await this.membership(userId);
    this.requireMembershipRole(membership.role, ['OWNER', 'MANAGER']);
    await this.storeById(membership.merchantId, storeId);
    const { version, latitude, longitude, active, ...fields } = input;
    await this.database.$transaction(async (transaction) => {
      const result = await transaction.store.updateMany({
        where: { id: storeId, merchantId: membership.merchantId, version },
        data: {
          ...fields,
          ...(fields.phone
            ? { phone: normalizeEgyptianPhone(fields.phone) }
            : {}),
          ...(active === undefined
            ? {}
            : { status: active ? 'ACTIVE' : 'INACTIVE' }),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new ConflictException('Store was updated.');
      if (latitude !== undefined && longitude !== undefined) {
        await transaction.$executeRaw`
          UPDATE "Store"
          SET "location" = ST_SetSRID(
            ST_MakePoint(${longitude}, ${latitude}),
            4326
          )::geography
          WHERE "id" = ${storeId}::uuid
            AND "merchantId" = ${membership.merchantId}::uuid
        `;
      }
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: membership.role,
        action: 'store.updated',
        entityType: 'Store',
        entityId: storeId,
      });
      return result;
    });
    return this.storeById(membership.merchantId, storeId);
  }

  public async addStaff(
    userId: string,
    input: { phone: string; displayName: string; role: MerchantRole },
  ) {
    const actor = await this.membership(userId);
    this.assertCanManageRole(actor.role, input.role);
    const phone = normalizeEgyptianPhone(input.phone);
    return this.database.$transaction(async (transaction) => {
      const found = await transaction.user.findUnique({ where: { phone } });
      if (found && !['OWNER', 'MANAGER', 'STAFF'].includes(found.role)) {
        throw new ConflictException('Phone belongs to another account type.');
      }
      if (
        found &&
        (await transaction.merchantMembership.findFirst({
          where: {
            userId: found.id,
            active: true,
            merchantId: { not: actor.merchantId },
          },
        }))
      ) {
        throw new ConflictException(
          'User already belongs to another active merchant.',
        );
      }
      const staff = await transaction.user.upsert({
        where: { phone },
        update: {
          displayName: input.displayName,
          role: merchantDatabaseRole[input.role],
        },
        create: {
          phone,
          displayName: input.displayName,
          role: merchantDatabaseRole[input.role],
          status: 'PENDING',
        },
      });
      const membership = await transaction.merchantMembership.upsert({
        where: {
          merchantId_userId: {
            merchantId: actor.merchantId,
            userId: staff.id,
          },
        },
        update: {
          role: merchantDatabaseRole[input.role],
          active: true,
          deactivatedAt: null,
          invitedById: userId,
          version: { increment: 1 },
        },
        create: {
          merchantId: actor.merchantId,
          userId: staff.id,
          role: merchantDatabaseRole[input.role],
          invitedById: userId,
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: actor.role,
        action: 'merchant_staff.invited',
        entityType: 'MerchantMembership',
        entityId: membership.id,
      });
      return { ...membership, user: staff };
    });
  }

  public async staff(userId: string) {
    const actor = await this.membership(userId);
    return this.database.merchantMembership.findMany({
      where: { merchantId: actor.merchantId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  public async updateStaff(
    userId: string,
    membershipId: string,
    input: { role?: MerchantRole; active?: boolean; version: number },
  ) {
    const actor = await this.membership(userId);
    if (input.role) this.assertCanManageRole(actor.role, input.role);
    return this.database.$transaction(
      async (transaction) => {
        const target = await transaction.merchantMembership.findFirst({
          where: { id: membershipId, merchantId: actor.merchantId },
        });
        if (!target) {
          throw new NotFoundException('Staff membership was not found.');
        }
        if (
          target.role === 'OWNER' &&
          (input.active === false ||
            (input.role && input.role !== 'merchant_owner'))
        ) {
          const owners = await transaction.merchantMembership.count({
            where: {
              merchantId: actor.merchantId,
              role: 'OWNER',
              active: true,
            },
          });
          if (owners <= 1) {
            throw new ConflictException(
              'A merchant must retain an active owner.',
            );
          }
        }
        const result = await transaction.merchantMembership.updateMany({
          where: {
            id: membershipId,
            merchantId: actor.merchantId,
            version: input.version,
          },
          data: {
            ...(input.role ? { role: merchantDatabaseRole[input.role] } : {}),
            ...(input.active === undefined
              ? {}
              : {
                  active: input.active,
                  deactivatedAt: input.active ? null : new Date(),
                }),
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          throw new ConflictException('Staff was updated.');
        }
        if (input.role) {
          await transaction.user.update({
            where: { id: target.userId },
            data: { role: merchantDatabaseRole[input.role] },
          });
        }
        await writeAudit(transaction, {
          actorId: userId,
          actorRole: actor.role,
          action: 'merchant_staff.updated',
          entityType: 'MerchantMembership',
          entityId: membershipId,
        });
        return transaction.merchantMembership.findUniqueOrThrow({
          where: { id: membershipId },
          include: { user: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async membership(userId: string) {
    const membership = await this.database.merchantMembership.findFirst({
      where: { userId, active: true },
      include: { merchant: true },
    });
    if (!membership) {
      throw new NotFoundException('No active merchant membership was found.');
    }
    return membership;
  }

  private async storeById(merchantId: string, storeId: string) {
    const [store] = await this.database.$queryRaw<
      Array<Record<string, unknown>>
    >`
      SELECT
        "id", "merchantId", "name", "phone", "addressLine", "area", "city",
        "workingHours", "status", "version", "createdAt", "updatedAt",
        ST_Y("location"::geometry) AS "latitude",
        ST_X("location"::geometry) AS "longitude"
      FROM "Store"
      WHERE "id" = ${storeId}::uuid
        AND "merchantId" = ${merchantId}::uuid
      LIMIT 1
    `;
    if (!store) throw new NotFoundException('Store was not found.');
    return store;
  }

  private requireMembershipRole(
    actual: UserRole,
    allowed: readonly UserRole[],
  ): void {
    if (!allowed.includes(actual)) {
      throw new ForbiddenException('Your merchant role cannot do this.');
    }
  }

  private assertCanManageRole(
    actorRole: UserRole,
    targetRole: MerchantRole,
  ): void {
    this.requireMembershipRole(actorRole, ['OWNER', 'MANAGER']);
    if (actorRole === 'MANAGER' && targetRole !== 'merchant_staff') {
      throw new ForbiddenException('Managers may only manage staff members.');
    }
  }
}
