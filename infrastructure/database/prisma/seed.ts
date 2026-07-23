import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createDatabaseClient,
  type CourierVerificationStatus,
  type DocumentStatus,
  type DocumentType,
  type UserRole,
} from '../../../packages/database/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed Wasel.');

const prisma = createDatabaseClient(databaseUrl);
const ids = {
  merchant: '10000000-0000-4000-8000-000000000001',
  store: '20000000-0000-4000-8000-000000000001',
  owner: '30000000-0000-4000-8000-000000000001',
  manager: '30000000-0000-4000-8000-000000000002',
  staff: '30000000-0000-4000-8000-000000000003',
  operationsAdmin: '30000000-0000-4000-8000-000000000004',
  superAdmin: '30000000-0000-4000-8000-000000000005',
  financeAdmin: '30000000-0000-4000-8000-000000000006',
  incompleteUser: '30000000-0000-4000-8000-000000000011',
  pendingUser: '30000000-0000-4000-8000-000000000012',
  approvedUser: '30000000-0000-4000-8000-000000000013',
  changesUser: '30000000-0000-4000-8000-000000000014',
  incompleteCourier: '40000000-0000-4000-8000-000000000011',
  pendingCourier: '40000000-0000-4000-8000-000000000012',
  approvedCourier: '40000000-0000-4000-8000-000000000013',
  changesCourier: '40000000-0000-4000-8000-000000000014',
  pricingRule: '60000000-0000-4000-8000-000000000001',
} as const;

const documentTypes = [
  'NATIONAL_ID_FRONT',
  'NATIONAL_ID_BACK',
  'DRIVER_LICENSE',
  'VEHICLE_LICENSE',
  'PROFILE_PHOTO',
] as const satisfies readonly DocumentType[];

async function seedUsers(): Promise<void> {
  const users: Array<{
    id: string;
    phone: string;
    displayName: string;
    role: UserRole;
  }> = [
    {
      id: ids.owner,
      phone: '+201001000001',
      displayName: 'مالك متجر تجريبي',
      role: 'OWNER',
    },
    {
      id: ids.manager,
      phone: '+201001000002',
      displayName: 'مدير متجر تجريبي',
      role: 'MANAGER',
    },
    {
      id: ids.staff,
      phone: '+201001000003',
      displayName: 'موظف متجر تجريبي',
      role: 'STAFF',
    },
    {
      id: ids.operationsAdmin,
      phone: '+201001000004',
      displayName: 'مسؤول عمليات تجريبي',
      role: 'OPERATIONS_ADMIN',
    },
    {
      id: ids.superAdmin,
      phone: '+201001000005',
      displayName: 'مسؤول نظام تجريبي',
      role: 'SUPER_ADMIN',
    },
    {
      id: ids.financeAdmin,
      phone: '+201001000006',
      displayName: 'مسؤول مالية تجريبي',
      role: 'FINANCE_ADMIN',
    },
    {
      id: ids.incompleteUser,
      phone: '+201001000011',
      displayName: 'مندوب غير مكتمل',
      role: 'COURIER',
    },
    {
      id: ids.pendingUser,
      phone: '+201001000012',
      displayName: 'مندوب قيد المراجعة',
      role: 'COURIER',
    },
    {
      id: ids.approvedUser,
      phone: '+201001000013',
      displayName: 'مندوب معتمد',
      role: 'COURIER',
    },
    {
      id: ids.changesUser,
      phone: '+201001000014',
      displayName: 'مندوب مطلوب منه تعديل',
      role: 'COURIER',
    },
  ];
  for (const user of users) {
    await prisma.user.upsert({
      where: { phone: user.phone },
      update: {
        displayName: user.displayName,
        role: user.role,
        status: 'ACTIVE',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      create: {
        ...user,
        status: 'ACTIVE',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  }
}

async function seedMerchant(): Promise<void> {
  await prisma.merchant.upsert({
    where: { id: ids.merchant },
    update: {
      legalName: 'شركة واصل التجريبية للتجارة',
      displayName: 'متجر النيل التجريبي',
      status: 'ACTIVE',
    },
    create: {
      id: ids.merchant,
      legalName: 'شركة واصل التجريبية للتجارة',
      displayName: 'متجر النيل التجريبي',
      status: 'ACTIVE',
      commissionRate: '0.1500',
    },
  });
  for (const membership of [
    { userId: ids.owner, role: 'OWNER' as const },
    { userId: ids.manager, role: 'MANAGER' as const },
    { userId: ids.staff, role: 'STAFF' as const },
  ]) {
    await prisma.merchantMembership.upsert({
      where: {
        merchantId_userId: {
          merchantId: ids.merchant,
          userId: membership.userId,
        },
      },
      update: { role: membership.role, active: true, deactivatedAt: null },
      create: {
        merchantId: ids.merchant,
        userId: membership.userId,
        role: membership.role,
      },
    });
  }
  await prisma.store.upsert({
    where: { id: ids.store },
    update: {
      status: 'ACTIVE',
      workingHours: {
        sunday: { open: '08:00', close: '23:00', closed: false },
        monday: { open: '08:00', close: '23:00', closed: false },
      },
    },
    create: {
      id: ids.store,
      merchantId: ids.merchant,
      name: 'فرع الدقي',
      phone: '+201001000001',
      addressLine: '١٢ شارع التحرير، الدقي',
      area: 'الدقي',
      city: 'الجيزة',
      workingHours: {
        sunday: { open: '08:00', close: '23:00', closed: false },
        monday: { open: '08:00', close: '23:00', closed: false },
      },
    },
  });
  await prisma.$executeRaw`
    UPDATE "Store"
    SET "location" = ST_SetSRID(ST_MakePoint(${31.205856}, ${30.038542}), 4326)::geography
    WHERE "id" = ${ids.store}::uuid
  `;
}

async function seedCourier(input: {
  sequence: number;
  userId: string;
  courierId: string;
  fullName: string;
  status: CourierVerificationStatus;
  documentStatus?: DocumentStatus;
}): Promise<void> {
  await prisma.courierProfile.upsert({
    where: { userId: input.userId },
    update: {
      fullName: input.fullName,
      verificationStatus: input.status,
      preferredCity: 'الجيزة',
      statusReason:
        input.status === 'CHANGES_REQUESTED'
          ? 'يرجى استبدال صورة الهوية الأمامية.'
          : null,
    },
    create: {
      id: input.courierId,
      userId: input.userId,
      fullName: input.fullName,
      verificationStatus: input.status,
      preferredCity: 'الجيزة',
      submittedAt:
        input.status === 'INCOMPLETE'
          ? null
          : new Date('2026-07-20T10:00:00.000Z'),
      approvedAt:
        input.status === 'APPROVED'
          ? new Date('2026-07-21T10:00:00.000Z')
          : null,
      statusReason:
        input.status === 'CHANGES_REQUESTED'
          ? 'يرجى استبدال صورة الهوية الأمامية.'
          : null,
    },
  });
  if (!input.documentStatus) return;

  const vehicleId = `5000000${input.sequence}-0000-4000-8000-000000000001`;
  await prisma.vehicle.upsert({
    where: { plateNumber: `تجريبي-${input.sequence}` },
    update: { active: true, type: 'MOTORCYCLE' },
    create: {
      id: vehicleId,
      courierId: input.courierId,
      type: 'MOTORCYCLE',
      plateNumber: `تجريبي-${input.sequence}`,
      manufacturer: 'Demo',
      model: 'Phase 1',
      color: 'أخضر',
    },
  });

  const storageRoot = resolve(process.env.STORAGE_LOCAL_DIR ?? '.data/uploads');
  const courierDirectory = resolve(storageRoot, input.courierId);
  await mkdir(courierDirectory, { recursive: true });
  for (const [index, type] of documentTypes.entries()) {
    const documentId = `7000000${input.sequence}-0000-4000-8000-00000000000${index + 1}`;
    const storageKey = `${input.courierId}/${documentId}`;
    const bytes = Buffer.from(
      `%PDF-1.4\n% Wasel Phase 1 synthetic ${type} document\n`,
    );
    await writeFile(resolve(storageRoot, storageKey), bytes);
    const status =
      input.status === 'CHANGES_REQUESTED' && type === 'NATIONAL_ID_FRONT'
        ? 'CHANGES_REQUESTED'
        : input.documentStatus;
    await prisma.courierDocument.upsert({
      where: { id: documentId },
      update: {
        status,
        storageKey,
        expiresAt: type === 'PROFILE_PHOTO' ? null : new Date('2030-12-31'),
        reviewNotes:
          status === 'CHANGES_REQUESTED'
            ? 'الصورة غير واضحة، يرجى الاستبدال.'
            : null,
        isCurrent: true,
      },
      create: {
        id: documentId,
        courierId: input.courierId,
        vehicleId: type === 'VEHICLE_LICENSE' ? vehicleId : null,
        type,
        status,
        storageKey,
        originalFilename: `${type.toLowerCase()}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        checksumSha256:
          '5e3bf8a72e5e58a9a28b834becb4654794831347a7a354b4c9fb665f89b40470',
        documentNumber: `DEMO-${input.sequence}-${index + 1}`,
        issuedAt: new Date('2025-01-01'),
        expiresAt: type === 'PROFILE_PHOTO' ? null : new Date('2030-12-31'),
        reviewNotes:
          status === 'CHANGES_REQUESTED'
            ? 'الصورة غير واضحة، يرجى الاستبدال.'
            : null,
      },
    });
  }
}

async function seedFoundationConfiguration(): Promise<void> {
  await prisma.pricingRule.upsert({
    where: { city_area_version: { city: 'الجيزة', area: '*', version: 1 } },
    update: { active: true },
    create: {
      id: ids.pricingRule,
      city: 'الجيزة',
      area: '*',
      version: 1,
      baseFee: '20.00',
      perKmFee: '5.00',
      minimumFee: '25.00',
      commissionRate: '0.1500',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const flags = [
    ['cash_on_delivery', 'الدفع عند الاستلام'],
    ['surge_pricing', 'التسعير وقت الذروة'],
    ['scheduled_deliveries', 'الطلبات المجدولة'],
    ['multi_stop_delivery', 'الطلبات متعددة المحطات'],
    ['subscriptions', 'اشتراكات التجار'],
  ] as const;
  for (const [key, description] of flags) {
    await prisma.featureFlag.upsert({
      where: { key },
      update: { enabled: false, rolloutPercent: 0 },
      create: { key, description, enabled: false, rolloutPercent: 0 },
    });
  }
}

async function seed(): Promise<void> {
  await seedUsers();
  await seedMerchant();
  await seedCourier({
    sequence: 1,
    userId: ids.incompleteUser,
    courierId: ids.incompleteCourier,
    fullName: 'مندوب غير مكتمل',
    status: 'INCOMPLETE',
  });
  await seedCourier({
    sequence: 2,
    userId: ids.pendingUser,
    courierId: ids.pendingCourier,
    fullName: 'مندوب قيد المراجعة',
    status: 'PENDING_REVIEW',
    documentStatus: 'PENDING',
  });
  await seedCourier({
    sequence: 3,
    userId: ids.approvedUser,
    courierId: ids.approvedCourier,
    fullName: 'مندوب معتمد',
    status: 'APPROVED',
    documentStatus: 'APPROVED',
  });
  await seedCourier({
    sequence: 4,
    userId: ids.changesUser,
    courierId: ids.changesCourier,
    fullName: 'مندوب مطلوب منه تعديل',
    status: 'CHANGES_REQUESTED',
    documentStatus: 'APPROVED',
  });
  await seedFoundationConfiguration();
  console.info(
    'Seeded Phase 1 merchant staff, store, courier review states, administrators, and disabled feature flags.',
  );
  console.info(
    'All demo phone numbers use OTP_MOCK_CODE (default 123456); no real personal data is present.',
  );
}

seed()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
