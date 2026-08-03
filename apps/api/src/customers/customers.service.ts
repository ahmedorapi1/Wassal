import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@wasel/database';
import { normalizeEgyptianPhone } from '@wasel/validation';

import { writeAudit } from '../infrastructure/audit.js';
import { DATABASE } from '../infrastructure/tokens.js';
import {
  merchantContext,
  requireMerchantRole,
} from '../merchant/merchant-context.js';

type CustomerInput = {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
};

type AddressInput = {
  label?: string;
  contactName: string;
  contactPhone: string;
  addressLine: string;
  street?: string;
  buildingNumber?: string;
  floor?: string;
  apartment?: string;
  landmark?: string;
  area: string;
  city: string;
  governorate: string;
  instructions?: string;
  deliveryNotes?: string;
  sourceMapsUrl?: string;
  latitude: number;
  longitude: number;
};

@Injectable()
export class CustomersService {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
  ) {}

  public async create(userId: string, input: CustomerInput) {
    const membership = await merchantContext(this.database, userId);
    const normalizedPhone = normalizeEgyptianPhone(input.phone);
    const duplicate = await this.database.customer.findUnique({
      where: {
        merchantId_normalizedPhone: {
          merchantId: membership.merchantId,
          normalizedPhone,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException(
        'A customer with this phone already exists for your merchant.',
      );
    }
    return this.database.$transaction(async (transaction) => {
      const customer = await transaction.customer.create({
        data: {
          merchantId: membership.merchantId,
          name: input.name,
          normalizedPhone,
          email: input.email,
          notes: input.notes,
        },
      });
      await writeAudit(transaction, {
        actorId: userId,
        actorRole: membership.role,
        action: 'customer.created',
        entityType: 'Customer',
        entityId: customer.id,
      });
      return customer;
    });
  }

  public async list(
    userId: string,
    input: { search?: string; status?: 'ACTIVE' | 'ARCHIVED' },
  ) {
    const membership = await merchantContext(this.database, userId);
    return this.database.customer.findMany({
      where: {
        merchantId: membership.merchantId,
        status: input.status ?? 'ACTIVE',
        ...(input.search
          ? {
              OR: [
                {
                  name: {
                    contains: input.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  normalizedPhone: {
                    contains: normalizeEgyptianPhone(input.search),
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        _count: {
          select: {
            addresses: { where: { archivedAt: null } },
            orders: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  public async get(userId: string, customerId: string) {
    const membership = await merchantContext(this.database, userId);
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, merchantId: membership.merchantId },
      include: {
        addresses: {
          where: { archivedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer was not found.');
    return {
      ...customer,
      addresses: customer.addresses.map((address) => ({
        ...address,
        latitude: Number(address.latitude),
        longitude: Number(address.longitude),
      })),
    };
  }

  public async update(
    userId: string,
    customerId: string,
    input: Partial<CustomerInput> & { version: number },
  ) {
    const membership = await merchantContext(this.database, userId);
    const { version, phone, ...fields } = input;
    const result = await this.database.customer.updateMany({
      where: {
        id: customerId,
        merchantId: membership.merchantId,
        version,
      },
      data: {
        ...fields,
        ...(phone ? { normalizedPhone: normalizeEgyptianPhone(phone) } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Customer was updated. Reload and retry.');
    }
    return this.get(userId, customerId);
  }

  public async setArchived(
    userId: string,
    customerId: string,
    archived: boolean,
  ) {
    const membership = await merchantContext(this.database, userId);
    requireMerchantRole(membership.role, ['OWNER', 'MANAGER']);
    const result = await this.database.customer.updateMany({
      where: { id: customerId, merchantId: membership.merchantId },
      data: {
        status: archived ? 'ARCHIVED' : 'ACTIVE',
        archivedAt: archived ? new Date() : null,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException('Customer was not found.');
    }
    return this.get(userId, customerId);
  }

  public async createAddress(
    userId: string,
    customerId: string,
    input: AddressInput,
  ) {
    const membership = await merchantContext(this.database, userId);
    await this.requireCustomer(membership.merchantId, customerId);
    const address = await this.database.$transaction(async (transaction) => {
      const created = await transaction.address.create({
        data: {
          merchantId: membership.merchantId,
          customerId,
          label: input.label,
          contactName: input.contactName,
          contactPhone: normalizeEgyptianPhone(input.contactPhone),
          addressLine: input.addressLine,
          street: input.street,
          buildingNumber: input.buildingNumber,
          floor: input.floor,
          apartment: input.apartment,
          landmark: input.landmark,
          area: input.area,
          city: input.city,
          governorate: input.governorate,
          instructions: input.instructions,
          deliveryNotes: input.deliveryNotes,
          sourceMapsUrl: input.sourceMapsUrl,
          latitude: input.latitude,
          longitude: input.longitude,
          source: 'SAVED',
          validationStatus: 'VALIDATED',
        },
      });
      await transaction.$executeRaw`
        UPDATE "Address"
        SET "location" = ST_SetSRID(
          ST_MakePoint(${input.longitude}, ${input.latitude}),
          4326
        )::geography
        WHERE "id" = ${created.id}::uuid
      `;
      return created;
    });
    return this.address(userId, customerId, address.id);
  }

  public async addresses(userId: string, customerId: string) {
    const customer = await this.get(userId, customerId);
    return customer.addresses;
  }

  public async updateAddress(
    userId: string,
    customerId: string,
    addressId: string,
    input: Partial<AddressInput> & { version: number },
  ) {
    const membership = await merchantContext(this.database, userId);
    const { version, latitude, longitude, contactPhone, ...fields } = input;
    await this.database.$transaction(async (transaction) => {
      const result = await transaction.address.updateMany({
        where: {
          id: addressId,
          customerId,
          merchantId: membership.merchantId,
          archivedAt: null,
          version,
        },
        data: {
          ...fields,
          ...(contactPhone
            ? { contactPhone: normalizeEgyptianPhone(contactPhone) }
            : {}),
          ...(latitude === undefined ? {} : { latitude }),
          ...(longitude === undefined ? {} : { longitude }),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('Address was updated. Reload and retry.');
      }
      if (latitude !== undefined && longitude !== undefined) {
        await transaction.$executeRaw`
          UPDATE "Address"
          SET "location" = ST_SetSRID(
            ST_MakePoint(${longitude}, ${latitude}),
            4326
          )::geography
          WHERE "id" = ${addressId}::uuid
        `;
      }
    });
    return this.address(userId, customerId, addressId);
  }

  public async archiveAddress(
    userId: string,
    customerId: string,
    addressId: string,
  ) {
    const membership = await merchantContext(this.database, userId);
    const result = await this.database.address.updateMany({
      where: {
        id: addressId,
        customerId,
        merchantId: membership.merchantId,
        archivedAt: null,
      },
      data: { archivedAt: new Date(), version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new NotFoundException('Address was not found.');
    return { archived: true };
  }

  private async address(userId: string, customerId: string, addressId: string) {
    const membership = await merchantContext(this.database, userId);
    const address = await this.database.address.findFirst({
      where: {
        id: addressId,
        customerId,
        merchantId: membership.merchantId,
      },
    });
    if (!address) throw new NotFoundException('Address was not found.');
    return {
      ...address,
      latitude: Number(address.latitude),
      longitude: Number(address.longitude),
    };
  }

  private async requireCustomer(merchantId: string, customerId: string) {
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, merchantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer was not found.');
  }
}
