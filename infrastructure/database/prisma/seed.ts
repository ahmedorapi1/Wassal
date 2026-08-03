import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

import {
  createDatabaseClient,
  type CourierVerificationStatus,
  type DocumentStatus,
  type DocumentType,
  type UserRole,
} from '../../../packages/database/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed WASSAL.');

const prisma = createDatabaseClient(databaseUrl);
const scrypt = promisify(scryptCallback);

async function demoPasswordHash(phone: string, password: string) {
  const salt = createHash('sha256')
    .update(`wassal-demo:${phone}`)
    .digest()
    .subarray(0, 16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt-v1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
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
  approvedUserTwo: '30000000-0000-4000-8000-000000000015',
  approvedUserThree: '30000000-0000-4000-8000-000000000016',
  suspendedUser: '30000000-0000-4000-8000-000000000017',
  incompleteCourier: '40000000-0000-4000-8000-000000000011',
  pendingCourier: '40000000-0000-4000-8000-000000000012',
  approvedCourier: '40000000-0000-4000-8000-000000000013',
  changesCourier: '40000000-0000-4000-8000-000000000014',
  approvedCourierTwo: '40000000-0000-4000-8000-000000000015',
  approvedCourierThree: '40000000-0000-4000-8000-000000000016',
  suspendedCourier: '40000000-0000-4000-8000-000000000017',
  pricingRule: '60000000-0000-4000-8000-000000000001',
  pricingRuleHistorical: '60000000-0000-4000-8000-000000000002',
  pricingRuleActive: '60000000-0000-4000-8000-000000000003',
  pricingRulePhaseThree: '60000000-0000-4000-8000-000000000004',
  serviceZone: '80000000-0000-4000-8000-000000000001',
  serviceZoneTwo: '80000000-0000-4000-8000-000000000002',
  financialSettings: '90000000-0000-4000-8000-000000000002',
  customerOne: '81000000-0000-4000-8000-000000000001',
  customerTwo: '81000000-0000-4000-8000-000000000002',
  pickupAddress: '82000000-0000-4000-8000-000000000001',
  dropoffOne: '82000000-0000-4000-8000-000000000002',
  dropoffTwo: '82000000-0000-4000-8000-000000000003',
  quoteDraft: '83000000-0000-4000-8000-000000000001',
  quoteActive: '83000000-0000-4000-8000-000000000002',
  quoteSearching: '83000000-0000-4000-8000-000000000003',
  quoteCancelled: '83000000-0000-4000-8000-000000000004',
  orderDraft: '84000000-0000-4000-8000-000000000001',
  orderQuoted: '84000000-0000-4000-8000-000000000002',
  orderSearching: '84000000-0000-4000-8000-000000000003',
  orderCancelled: '84000000-0000-4000-8000-000000000004',
  phaseThreeQuoteAvailable: '86000000-0000-4000-8000-000000000001',
  phaseThreeQuoteAssigned: '86000000-0000-4000-8000-000000000002',
  phaseThreeQuoteOverdue: '86000000-0000-4000-8000-000000000003',
  phaseThreeQuotePartial: '86000000-0000-4000-8000-000000000004',
  phaseThreeQuotePaidReturn: '86000000-0000-4000-8000-000000000005',
  phaseThreeQuoteOpen: '86000000-0000-4000-8000-000000000006',
  phaseThreeOrderAvailable: '87000000-0000-4000-8000-000000000001',
  phaseThreeOrderAssigned: '87000000-0000-4000-8000-000000000002',
  phaseThreeOrderOverdue: '87000000-0000-4000-8000-000000000003',
  phaseThreeOrderPartial: '87000000-0000-4000-8000-000000000004',
  phaseThreeOrderPaidReturn: '87000000-0000-4000-8000-000000000005',
  phaseThreeOrderOpen: '87000000-0000-4000-8000-000000000006',
  settlementOverdue: '88000000-0000-4000-8000-000000000001',
  settlementPartial: '88000000-0000-4000-8000-000000000002',
  settlementPaid: '88000000-0000-4000-8000-000000000003',
  settlementOpen: '88000000-0000-4000-8000-000000000004',
  paymentPartial: '89000000-0000-4000-8000-000000000001',
  paymentPaid: '89000000-0000-4000-8000-000000000002',
  operationalSettings: '91000000-0000-4000-8000-000000000001',
  phaseFourQuoteReview: '92000000-0000-4000-8000-000000000001',
  phaseFourQuoteDelivered: '92000000-0000-4000-8000-000000000002',
  phaseFourQuotePast: '92000000-0000-4000-8000-000000000003',
  phaseFourQuoteDisputed: '92000000-0000-4000-8000-000000000004',
  phaseFourQuoteFailed: '92000000-0000-4000-8000-000000000005',
  phaseFourQuoteReturnAwaiting: '92000000-0000-4000-8000-000000000006',
  phaseFourOrderDelivered: '93000000-0000-4000-8000-000000000002',
  phaseFourOrderPast: '93000000-0000-4000-8000-000000000003',
  phaseFourOrderDisputed: '93000000-0000-4000-8000-000000000004',
  phaseFourOrderFailed: '93000000-0000-4000-8000-000000000005',
  phaseFourOrderReturnAwaiting: '93000000-0000-4000-8000-000000000006',
  phaseFourOpenDispute: '94000000-0000-4000-8000-000000000001',
  phaseFourResolvedDispute: '94000000-0000-4000-8000-000000000002',
  phaseFourProofPending: '95000000-0000-4000-8000-000000000001',
  phaseFourProofPartial: '95000000-0000-4000-8000-000000000002',
  phaseFourProofRejected: '95000000-0000-4000-8000-000000000003',
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
    {
      id: ids.approvedUserTwo,
      phone: '+201001000015',
      displayName: 'مندوب معتمد ثانٍ',
      role: 'COURIER',
    },
    {
      id: ids.approvedUserThree,
      phone: '+201001000016',
      displayName: 'مندوب معتمد ثالث',
      role: 'COURIER',
    },
    {
      id: ids.suspendedUser,
      phone: '+201001000017',
      displayName: 'مندوب موقوف تجريبي',
      role: 'COURIER',
    },
  ];
  for (const user of users) {
    const password =
      user.role === 'OWNER' || user.role === 'MANAGER' || user.role === 'STAFF'
        ? 'MerchantDemo123'
        : user.role === 'COURIER'
          ? 'CourierDemo123'
          : 'AdminDemo123';
    const passwordHash = await demoPasswordHash(user.phone, password);
    await prisma.user.upsert({
      where: { phone: user.phone },
      update: {
        displayName: user.displayName,
        role: user.role,
        status: 'ACTIVE',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash,
        passwordChangedAt: new Date('2026-07-27T00:00:00.000Z'),
        forcePasswordChange: false,
      },
      create: {
        ...user,
        status: 'ACTIVE',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash,
        passwordChangedAt: new Date('2026-07-27T00:00:00.000Z'),
      },
    });
  }
}

async function seedMerchant(): Promise<void> {
  await prisma.merchant.upsert({
    where: { id: ids.merchant },
    update: {
      legalName: 'شركة متجر النيل التجريبية للتجارة',
      displayName: 'متجر النيل التجريبي',
      businessCategory: 'متجر تجزئة',
      contactPhone: '+201001000001',
      contactEmail: 'merchant.demo@example.test',
      status: 'ACTIVE',
      reviewNotes: null,
    },
    create: {
      id: ids.merchant,
      legalName: 'شركة متجر النيل التجريبية للتجارة',
      displayName: 'متجر النيل التجريبي',
      businessCategory: 'متجر تجزئة',
      contactPhone: '+201001000001',
      contactEmail: 'merchant.demo@example.test',
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
      name: 'فرع دمياط التجريبي',
      phone: '+201001000001',
      addressLine: '١٢ شارع الميناء التجريبي، دمياط',
      governorate: 'دمياط',
      area: 'وسط دمياط',
      city: 'دمياط',
      street: 'شارع الميناء التجريبي',
      addressDetails: 'مبنى ١٢',
      status: 'ACTIVE',
      workingHours: {
        sunday: { open: '08:00', close: '23:00', closed: false },
        monday: { open: '08:00', close: '23:00', closed: false },
      },
    },
    create: {
      id: ids.store,
      merchantId: ids.merchant,
      name: 'فرع دمياط التجريبي',
      phone: '+201001000001',
      addressLine: '١٢ شارع الميناء التجريبي، دمياط',
      governorate: 'دمياط',
      area: 'وسط دمياط',
      city: 'دمياط',
      street: 'شارع الميناء التجريبي',
      addressDetails: 'مبنى ١٢',
      workingHours: {
        sunday: { open: '08:00', close: '23:00', closed: false },
        monday: { open: '08:00', close: '23:00', closed: false },
      },
    },
  });
  await prisma.$executeRaw`
    UPDATE "Store"
    SET "location" = ST_SetSRID(ST_MakePoint(${31.81444}, ${31.41754}), 4326)::geography
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
      preferredCity: 'دمياط',
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
      preferredCity: 'دمياط',
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
      `%PDF-1.4\n% WASSAL Phase 1 synthetic ${type} document\n`,
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

async function seedPhaseTwoConfiguration(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ServiceZone" (
      "id", "name", "countryCode", "governorate", "city",
      "centerLatitude", "centerLongitude", "radiusKm", "boundary",
      "status", "allowedPickup", "allowedDropoff",
      "maximumRouteDistanceMeters", "priority", "version", "updatedAt"
    )
    VALUES (
      ${ids.serviceZone}::uuid,
      'منطقة دمياط التجريبية',
      'EG',
      'دمياط',
      'دمياط',
      31.410000,
      31.825000,
      25.000,
      ST_Multi(ST_Buffer(
        ST_SetSRID(ST_MakePoint(31.825000, 31.410000), 4326)::geography,
        25000
      )::geometry)::geography,
      'ACTIVE',
      true,
      true,
      25000,
      100,
      1,
      NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name",
      "countryCode" = EXCLUDED."countryCode",
      "governorate" = EXCLUDED."governorate",
      "city" = EXCLUDED."city",
      "centerLatitude" = EXCLUDED."centerLatitude",
      "centerLongitude" = EXCLUDED."centerLongitude",
      "radiusKm" = EXCLUDED."radiusKm",
      "boundary" = EXCLUDED."boundary",
      "status" = 'ACTIVE',
      "allowedPickup" = true,
      "allowedDropoff" = true,
      "maximumRouteDistanceMeters" = EXCLUDED."maximumRouteDistanceMeters",
      "priority" = EXCLUDED."priority",
      "updatedAt" = NOW()
  `;

  const legacy = await prisma.pricingRule.findUnique({
    where: { id: ids.pricingRule },
    select: { id: true },
  });
  if (legacy) {
    await prisma.pricingRule.update({
      where: { id: legacy.id },
      data: { status: 'INACTIVE' },
    });
  }

  const sharedRule = {
    ruleFamilyKey: 'damietta-motorcycle-standard',
    countryCode: 'EG',
    governorate: 'دمياط',
    city: 'دمياط',
    serviceZoneId: ids.serviceZone,
    vehicleType: 'MOTORCYCLE' as const,
    currency: 'EGP',
    includedDistanceMeters: 1_000,
    maximumDistanceMeters: 25_000,
    smallPackageSurchargeMinor: 0,
    mediumPackageSurchargeMinor: 200,
    largePackageSurchargeMinor: 500,
    weightBands: [
      { upToGrams: 5_000, surchargeMinor: 0 },
      { upToGrams: 15_000, surchargeMinor: 400 },
      { upToGrams: 25_000, surchargeMinor: 800 },
    ],
    fragileSurchargeMinor: 250,
    thermalBagSurchargeMinor: 150,
    waitingFeePerMinuteMinor: 0,
    returnTripBaseMinor: 0,
    commissionType: 'PERCENTAGE' as const,
    commissionValue: 1_500,
    taxBasisPoints: 0,
    priority: 100,
  };
  await prisma.pricingRule.upsert({
    where: { id: ids.pricingRuleHistorical },
    update: { status: 'INACTIVE' },
    create: {
      id: ids.pricingRuleHistorical,
      ...sharedRule,
      version: 1,
      baseFeeMinor: 1_300,
      perKilometerMinor: 450,
      minimumFeeMinor: 1_800,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-06-30T23:59:59.000Z'),
      status: 'INACTIVE',
    },
  });
  await prisma.pricingRule.upsert({
    where: { id: ids.pricingRuleActive },
    update: { status: 'INACTIVE' },
    create: {
      id: ids.pricingRuleActive,
      ...sharedRule,
      version: 2,
      baseFeeMinor: 1_500,
      perKilometerMinor: 500,
      minimumFeeMinor: 2_000,
      effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
      status: 'INACTIVE',
    },
  });

  await prisma.pricingRule.updateMany({
    where: {
      serviceZoneId: ids.serviceZone,
      status: 'ACTIVE',
      id: { not: ids.pricingRulePhaseThree },
    },
    data: { status: 'INACTIVE' },
  });
  await prisma.pricingRule.upsert({
    where: { id: ids.pricingRulePhaseThree },
    update: { status: 'ACTIVE' },
    create: {
      id: ids.pricingRulePhaseThree,
      ...sharedRule,
      commissionValue: 2_000,
      version: 3,
      baseFeeMinor: 1_500,
      perKilometerMinor: 500,
      minimumFeeMinor: 2_000,
      effectiveFrom: new Date('2026-07-26T00:00:00.000Z'),
      status: 'ACTIVE',
    },
  });
}

async function seedPhaseThreeConfiguration(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ServiceZone" (
      "id", "name", "countryCode", "governorate", "city",
      "centerLatitude", "centerLongitude", "radiusKm", "boundary",
      "status", "allowedPickup", "allowedDropoff",
      "maximumRouteDistanceMeters", "priority", "version", "updatedAt"
    )
    VALUES (
      ${ids.serviceZoneTwo}::uuid,
      'منطقة بورسعيد التجريبية',
      'EG',
      'بورسعيد',
      'بورسعيد',
      31.275000,
      32.275000,
      15.000,
      ST_Multi(ST_Buffer(
        ST_SetSRID(ST_MakePoint(32.275000, 31.275000), 4326)::geography,
        15000
      )::geometry)::geography,
      'ACTIVE',
      true,
      true,
      25000,
      50,
      1,
      NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name",
      "countryCode" = EXCLUDED."countryCode",
      "governorate" = EXCLUDED."governorate",
      "city" = EXCLUDED."city",
      "centerLatitude" = EXCLUDED."centerLatitude",
      "centerLongitude" = EXCLUDED."centerLongitude",
      "radiusKm" = EXCLUDED."radiusKm",
      "boundary" = EXCLUDED."boundary",
      "status" = 'ACTIVE',
      "allowedPickup" = true,
      "allowedDropoff" = true,
      "maximumRouteDistanceMeters" = EXCLUDED."maximumRouteDistanceMeters",
      "priority" = EXCLUDED."priority",
      "updatedAt" = NOW()
  `;

  const setting = await prisma.platformFinancialSetting.findUnique({
    where: { version: 2 },
    select: { id: true },
  });
  if (!setting) {
    await prisma.platformFinancialSetting.create({
      data: {
        id: ids.financialSettings,
        defaultCommissionBasisPoints: 2_000,
        settlementCycle: 'WEEKLY',
        gracePeriodDays: 7,
        operationsTimezone: 'Africa/Cairo',
        effectiveFrom: new Date('2026-07-26T00:00:01.000Z'),
        version: 2,
        createdById: ids.superAdmin,
      },
    });
  }

  const memberships = [
    [ids.approvedCourier, ids.serviceZone],
    [ids.approvedCourierTwo, ids.serviceZone],
    [ids.approvedCourierThree, ids.serviceZone],
    [ids.approvedCourierThree, ids.serviceZoneTwo],
    [ids.suspendedCourier, ids.serviceZone],
  ] as const;
  for (const [courierId, serviceZoneId] of memberships) {
    await prisma.courierServiceZone.upsert({
      where: {
        courierId_serviceZoneId: { courierId, serviceZoneId },
      },
      update: { active: true },
      create: {
        courierId,
        serviceZoneId,
        createdById: ids.superAdmin,
      },
    });
  }
}

async function seedPhaseTwoCustomersAndAddresses(): Promise<void> {
  const customers = [
    {
      id: ids.customerOne,
      name: 'عميل تجريبي أول',
      normalizedPhone: '+201009000001',
      email: 'customer.one@example.test',
      notes: 'بيانات صناعية لا تخص شخصاً حقيقياً.',
    },
    {
      id: ids.customerTwo,
      name: 'عميل تجريبي ثانٍ',
      normalizedPhone: '+201009000002',
      email: 'customer.two@example.test',
      notes: 'عميل تجريبي لاختبار العناوين المحفوظة.',
    },
  ];
  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      update: {
        name: customer.name,
        normalizedPhone: customer.normalizedPhone,
        email: customer.email,
        notes: customer.notes,
        status: 'ACTIVE',
        archivedAt: null,
      },
      create: {
        ...customer,
        merchantId: ids.merchant,
        status: 'ACTIVE',
      },
    });
  }

  const addresses = [
    {
      id: ids.pickupAddress,
      customerId: null,
      label: ids.store,
      contactName: 'فرع دمياط التجريبي',
      contactPhone: '+201001000001',
      addressLine: '١٢ شارع الميناء التجريبي، دمياط',
      area: 'وسط دمياط',
      latitude: 31.41754,
      longitude: 31.81444,
      source: 'STORE' as const,
    },
    {
      id: ids.dropoffOne,
      customerId: ids.customerOne,
      label: 'المنزل',
      contactName: 'عميل تجريبي أول',
      contactPhone: '+201009000001',
      addressLine: '٢٥ شارع صناعي تجريبي، دمياط',
      area: 'الأعصر',
      latitude: 31.4321,
      longitude: 31.8273,
      source: 'SAVED' as const,
    },
    {
      id: ids.dropoffTwo,
      customerId: ids.customerTwo,
      label: 'المكتب',
      contactName: 'عميل تجريبي ثانٍ',
      contactPhone: '+201009000002',
      addressLine: '٨ شارع صناعي تجريبي، دمياط الجديدة',
      area: 'دمياط الجديدة',
      latitude: 31.44,
      longitude: 31.78,
      source: 'SAVED' as const,
    },
  ];
  for (const address of addresses) {
    await prisma.address.upsert({
      where: { id: address.id },
      update: {
        label: address.label,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        addressLine: address.addressLine,
        area: address.area,
        city: 'دمياط',
        governorate: 'دمياط',
        latitude: address.latitude,
        longitude: address.longitude,
        source: address.source,
        validationStatus: 'VALIDATED',
        archivedAt: null,
      },
      create: {
        ...address,
        merchantId: ids.merchant,
        city: 'دمياط',
        governorate: 'دمياط',
        validationStatus: 'VALIDATED',
      },
    });
    await prisma.$executeRaw`
      UPDATE "Address"
      SET "location" = ST_SetSRID(
        ST_MakePoint(${address.longitude}, ${address.latitude}),
        4326
      )::geography
      WHERE "id" = ${address.id}::uuid
    `;
  }
}

async function seedPhaseTwoQuotesAndOrders(): Promise<void> {
  const demoAcceptanceExpiresAt = new Date(Date.now() + 5 * 60 * 1_000);
  const customerSnapshot = {
    id: ids.customerOne,
    name: 'عميل تجريبي أول',
    normalizedPhone: '+201009000001',
    email: 'customer.one@example.test',
  };
  const pickupSnapshot = {
    id: ids.pickupAddress,
    label: ids.store,
    contactName: 'فرع دمياط التجريبي',
    contactPhone: '+201001000001',
    addressLine: '١٢ شارع الميناء التجريبي، دمياط',
    area: 'وسط دمياط',
    city: 'دمياط',
    governorate: 'دمياط',
    latitude: 31.41754,
    longitude: 31.81444,
  };
  const dropoffSnapshot = {
    id: ids.dropoffOne,
    label: 'المنزل',
    contactName: 'عميل تجريبي أول',
    contactPhone: '+201009000001',
    addressLine: '٢٥ شارع صناعي تجريبي، دمياط',
    area: 'الأعصر',
    city: 'دمياط',
    governorate: 'دمياط',
    latitude: 31.4321,
    longitude: 31.8273,
  };
  const packageSnapshot = {
    category: 'food',
    itemDescription: 'طرد طعام تجريبي',
    size: 'medium',
    weightGrams: 3_000,
    packageCount: 1,
    fragile: true,
    requiresThermalBag: false,
    declaredValueMinor: 15_000,
    prohibitedItemsConfirmed: true,
    merchantReference: 'DEMO-MERCHANT-001',
    customerOrderReference: 'DEMO-CUSTOMER-001',
  };
  const routeSnapshot = {
    distanceMeters: 3_000,
    durationSeconds: 450,
    provider: 'deterministic_local',
    providerVersion: 1,
  };
  const breakdown = {
    baseFeeMinor: 1_500,
    distanceChargeMinor: 1_000,
    packageSurchargeMinor: 200,
    weightSurchargeMinor: 0,
    fragileSurchargeMinor: 250,
    thermalBagSurchargeMinor: 0,
    discountMinor: 0,
    surgeAdjustmentMinor: 0,
    taxMinor: 0,
    merchantTotalMinor: 2_950,
    estimatedCourierEarningMinor: 2_507,
    platformCommissionMinor: 443,
    platformCommissionBasisPoints: 1_500,
    currency: 'EGP',
    pricingRuleVersion: 2,
  };
  const quotes = [
    {
      id: ids.quoteDraft,
      status: 'EXPIRED' as const,
      expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      consumedAt: null,
      fingerprint: '1'.repeat(64),
      key: 'seed-phase2-quote-draft-0001',
    },
    {
      id: ids.quoteActive,
      status: 'ACTIVE' as const,
      expiresAt: new Date('2099-12-31T23:59:59.000Z'),
      consumedAt: null,
      fingerprint: '2'.repeat(64),
      key: 'seed-phase2-quote-active-0002',
    },
    {
      id: ids.quoteSearching,
      status: 'CONSUMED' as const,
      expiresAt: new Date('2099-12-31T23:59:59.000Z'),
      consumedAt: new Date('2026-07-23T09:00:00.000Z'),
      fingerprint: '3'.repeat(64),
      key: 'seed-phase2-quote-searching-0003',
    },
    {
      id: ids.quoteCancelled,
      status: 'CONSUMED' as const,
      expiresAt: new Date('2099-12-31T23:59:59.000Z'),
      consumedAt: new Date('2026-07-23T08:00:00.000Z'),
      fingerprint: '4'.repeat(64),
      key: 'seed-phase2-quote-cancelled-0004',
    },
  ];
  for (const quote of quotes) {
    await prisma.priceQuote.upsert({
      where: { id: quote.id },
      update: {
        status: quote.status,
        consumedAt: quote.consumedAt,
      },
      create: {
        id: quote.id,
        merchantId: ids.merchant,
        storeId: ids.store,
        customerId: ids.customerOne,
        serviceZoneId: ids.serviceZone,
        pricingRuleId: ids.pricingRuleActive,
        createdById: ids.owner,
        pricingRuleVersion: 2,
        status: quote.status,
        customerSnapshot,
        pickupAddressSnapshot: pickupSnapshot,
        dropoffAddressSnapshot: dropoffSnapshot,
        packageSnapshot,
        routeSnapshot,
        distanceMeters: 3_000,
        durationSeconds: 450,
        ...breakdown,
        breakdown,
        requestFingerprint: quote.fingerprint,
        idempotencyKey: quote.key,
        expiresAt: quote.expiresAt,
        consumedAt: quote.consumedAt,
      },
    });
  }

  const orders = [
    {
      id: ids.orderDraft,
      quoteId: ids.quoteDraft,
      orderNumber: 'WSL-DEMO-DRAFT-01',
      status: 'DRAFT' as const,
    },
    {
      id: ids.orderQuoted,
      quoteId: ids.quoteActive,
      orderNumber: 'WSL-DEMO-QUOTED-02',
      status: 'QUOTED' as const,
    },
    {
      id: ids.orderSearching,
      quoteId: ids.quoteSearching,
      orderNumber: 'WSL-DEMO-SEARCH-03',
      status: 'SEARCHING_COURIER' as const,
    },
    {
      id: ids.orderCancelled,
      quoteId: ids.quoteCancelled,
      orderNumber: 'WSL-DEMO-CANCEL-04',
      status: 'CANCELLED' as const,
      cancelledAt: new Date('2026-07-23T08:05:00.000Z'),
      cancellationReasonCode: 'customer_cancelled',
      cancellationDetails: 'إلغاء تجريبي لاختبار سجل الأحداث.',
    },
  ];
  for (const order of orders) {
    await prisma.deliveryOrder.upsert({
      where: { id: order.id },
      update: {
        status: order.status,
        acceptanceExpiresAt:
          order.status === 'SEARCHING_COURIER' ? demoAcceptanceExpiresAt : null,
        dispatchAttemptCount: order.status === 'SEARCHING_COURIER' ? 1 : 0,
        cancelledAt: order.cancelledAt ?? null,
        cancellationReasonCode: order.cancellationReasonCode ?? null,
        cancellationDetails: order.cancellationDetails ?? null,
        cancelledByRole: order.status === 'CANCELLED' ? 'OWNER' : null,
      },
      create: {
        id: order.id,
        orderNumber: order.orderNumber,
        quoteId: order.quoteId,
        merchantId: ids.merchant,
        storeId: ids.store,
        customerId: ids.customerOne,
        pickupAddressId: ids.pickupAddress,
        dropoffAddressId: ids.dropoffOne,
        serviceZoneId: ids.serviceZone,
        pricingRuleId: ids.pricingRuleActive,
        createdById: ids.owner,
        status: order.status,
        acceptanceExpiresAt:
          order.status === 'SEARCHING_COURIER'
            ? demoAcceptanceExpiresAt
            : undefined,
        dispatchAttemptCount: order.status === 'SEARCHING_COURIER' ? 1 : 0,
        customerSnapshot,
        pickupAddressSnapshot: pickupSnapshot,
        dropoffAddressSnapshot: dropoffSnapshot,
        packageSnapshot,
        routeSnapshot,
        pricingSnapshot: breakdown,
        packageCategory: packageSnapshot.category,
        itemDescription: packageSnapshot.itemDescription,
        packageSize: 'MEDIUM',
        weightGrams: packageSnapshot.weightGrams,
        packageCount: packageSnapshot.packageCount,
        fragile: packageSnapshot.fragile,
        requiresThermalBag: packageSnapshot.requiresThermalBag,
        declaredValueMinor: packageSnapshot.declaredValueMinor,
        prohibitedItemsConfirmed: packageSnapshot.prohibitedItemsConfirmed,
        merchantReference: packageSnapshot.merchantReference,
        customerOrderReference: packageSnapshot.customerOrderReference,
        routeDistanceMeters: 3_000,
        estimatedDurationSeconds: 450,
        baseFeeMinor: breakdown.baseFeeMinor,
        distanceChargeMinor: breakdown.distanceChargeMinor,
        packageSurchargeMinor: breakdown.packageSurchargeMinor,
        weightSurchargeMinor: breakdown.weightSurchargeMinor,
        fragileSurchargeMinor: breakdown.fragileSurchargeMinor,
        thermalBagSurchargeMinor: breakdown.thermalBagSurchargeMinor,
        discountMinor: breakdown.discountMinor,
        surgeAdjustmentMinor: breakdown.surgeAdjustmentMinor,
        taxMinor: breakdown.taxMinor,
        merchantTotalMinor: breakdown.merchantTotalMinor,
        estimatedCourierEarningMinor: breakdown.estimatedCourierEarningMinor,
        platformCommissionMinor: breakdown.platformCommissionMinor,
        platformCommissionBasisPoints: breakdown.platformCommissionBasisPoints,
        currency: 'EGP',
        pricingVersion: 2,
        cancelledAt: order.cancelledAt,
        cancellationReasonCode: order.cancellationReasonCode,
        cancellationDetails: order.cancellationDetails,
        cancelledByRole: order.status === 'CANCELLED' ? 'OWNER' : undefined,
      },
    });
  }

  const seededEvents = [
    {
      id: '85000000-0000-4000-8000-000000000001',
      orderId: ids.orderDraft,
      eventType: 'ORDER_DRAFT_CREATED' as const,
      fromStatus: null,
      toStatus: 'DRAFT' as const,
      merchantMessage: 'تم إنشاء مسودة تجريبية.',
    },
    {
      id: '85000000-0000-4000-8000-000000000002',
      orderId: ids.orderQuoted,
      eventType: 'QUOTE_CREATED' as const,
      fromStatus: 'DRAFT' as const,
      toStatus: 'QUOTED' as const,
      merchantMessage: 'تم إنشاء عرض السعر التجريبي.',
    },
    {
      id: '85000000-0000-4000-8000-000000000003',
      orderId: ids.orderSearching,
      eventType: 'ORDER_CONFIRMED' as const,
      fromStatus: 'QUOTED' as const,
      toStatus: 'SEARCHING_COURIER' as const,
      merchantMessage: 'تم تأكيد الطلب التجريبي.',
    },
    {
      id: '85000000-0000-4000-8000-000000000004',
      orderId: ids.orderSearching,
      eventType: 'COURIER_SEARCH_REQUESTED' as const,
      fromStatus: 'SEARCHING_COURIER' as const,
      toStatus: 'SEARCHING_COURIER' as const,
      merchantMessage: 'البحث عن مندوب غير مفعل في المرحلة الثانية.',
    },
    {
      id: '85000000-0000-4000-8000-000000000005',
      orderId: ids.orderCancelled,
      eventType: 'ORDER_CANCELLED' as const,
      fromStatus: 'SEARCHING_COURIER' as const,
      toStatus: 'CANCELLED' as const,
      merchantMessage: 'تم إلغاء الطلب التجريبي.',
    },
  ];
  await prisma.orderEvent.createMany({
    data: seededEvents.map((event) => ({
      ...event,
      actorType: 'USER' as const,
      actorId: ids.owner,
      actorRole: 'OWNER' as const,
      source: 'SYSTEM' as const,
    })),
    skipDuplicates: true,
  });
}

async function seedPhaseThreeMarketplaceAndAccounting(): Promise<void> {
  const demoAcceptanceExpiresAt = new Date(Date.now() + 5 * 60 * 1_000);
  const customerSnapshot = {
    id: ids.customerOne,
    name: 'عميل المرحلة الثالثة',
    normalizedPhone: '+201009000001',
    email: 'customer.one@example.test',
  };
  const pickupAddressSnapshot = {
    id: ids.pickupAddress,
    label: ids.store,
    contactName: 'فرع دمياط التجريبي',
    contactPhone: '+201001000001',
    addressLine: '١٢ شارع الميناء التجريبي، دمياط',
    area: 'وسط دمياط',
    city: 'دمياط',
    governorate: 'دمياط',
    latitude: 31.41754,
    longitude: 31.81444,
  };
  const dropoffAddressSnapshot = {
    id: ids.dropoffOne,
    label: 'المنزل',
    contactName: 'عميل المرحلة الثالثة',
    contactPhone: '+201009000001',
    addressLine: '٢٥ شارع صناعي تجريبي، دمياط',
    area: 'الأعصر',
    city: 'دمياط',
    governorate: 'دمياط',
    instructions: 'بيانات تشغيل تجريبية فقط.',
    latitude: 31.4321,
    longitude: 31.8273,
  };
  const packageSnapshot = {
    category: 'food',
    itemDescription: 'طرد تجريبي للمرحلة الثالثة',
    size: 'medium',
    weightGrams: 3_000,
    packageCount: 1,
    fragile: true,
    requiresThermalBag: false,
    recipientNotes: 'لا تعرض قبل قبول الطلب.',
    courierNotes: 'تسليم تجريبي آمن.',
    declaredValueMinor: 15_000,
    prohibitedItemsConfirmed: true,
    merchantReference: 'PHASE3-DEMO',
  };
  const routeSnapshot = {
    distanceMeters: 3_000,
    durationSeconds: 450,
    provider: 'deterministic_local',
    providerVersion: 1,
  };
  const breakdown = {
    baseFeeMinor: 1_500,
    distanceChargeMinor: 1_000,
    packageSurchargeMinor: 200,
    weightSurchargeMinor: 0,
    fragileSurchargeMinor: 250,
    thermalBagSurchargeMinor: 0,
    discountMinor: 0,
    surgeAdjustmentMinor: 0,
    taxMinor: 0,
    merchantTotalMinor: 2_950,
    estimatedCourierEarningMinor: 2_360,
    platformCommissionMinor: 590,
    platformCommissionBasisPoints: 2_000,
    currency: 'EGP',
    pricingRuleVersion: 3,
    financialSettingsVersion: 2,
  };
  const demoOrders = [
    {
      quoteId: ids.phaseThreeQuoteAvailable,
      orderId: ids.phaseThreeOrderAvailable,
      orderNumber: 'WSL-PH3-AVAILABLE',
      status: 'SEARCHING_COURIER' as const,
      courierId: null,
      occurredAt: new Date('2026-07-26T08:00:00.000Z'),
    },
    {
      quoteId: ids.phaseThreeQuoteAssigned,
      orderId: ids.phaseThreeOrderAssigned,
      orderNumber: 'WSL-PH3-ASSIGNED',
      status: 'COURIER_ASSIGNED' as const,
      courierId: ids.approvedCourierTwo,
      occurredAt: new Date('2026-07-26T08:30:00.000Z'),
    },
    {
      quoteId: ids.phaseThreeQuoteOverdue,
      orderId: ids.phaseThreeOrderOverdue,
      orderNumber: 'WSL-PH3-OVERDUE',
      status: 'COMPLETED' as const,
      courierId: ids.approvedCourier,
      occurredAt: new Date('2026-07-01T09:00:00.000Z'),
    },
    {
      quoteId: ids.phaseThreeQuotePartial,
      orderId: ids.phaseThreeOrderPartial,
      orderNumber: 'WSL-PH3-PARTIAL',
      status: 'COMPLETED' as const,
      courierId: ids.approvedCourierTwo,
      occurredAt: new Date('2026-07-15T09:00:00.000Z'),
    },
    {
      quoteId: ids.phaseThreeQuotePaidReturn,
      orderId: ids.phaseThreeOrderPaidReturn,
      orderNumber: 'WSL-PH3-RETURNED',
      status: 'COMPLETED' as const,
      courierId: ids.approvedCourierThree,
      occurredAt: new Date('2026-07-08T09:00:00.000Z'),
      returned: true,
    },
    {
      quoteId: ids.phaseThreeQuoteOpen,
      orderId: ids.phaseThreeOrderOpen,
      orderNumber: 'WSL-PH3-OPEN',
      status: 'COMPLETED' as const,
      courierId: ids.approvedCourier,
      occurredAt: new Date('2026-07-22T09:00:00.000Z'),
    },
  ];

  for (const demo of demoOrders) {
    const quote = await prisma.priceQuote.findUnique({
      where: { id: demo.quoteId },
      select: { id: true },
    });
    if (!quote) {
      await prisma.priceQuote.create({
        data: {
          id: demo.quoteId,
          merchantId: ids.merchant,
          storeId: ids.store,
          customerId: ids.customerOne,
          serviceZoneId: ids.serviceZone,
          pricingRuleId: ids.pricingRulePhaseThree,
          createdById: ids.owner,
          pricingRuleVersion: 3,
          status: 'CONSUMED',
          customerSnapshot,
          pickupAddressSnapshot,
          dropoffAddressSnapshot,
          packageSnapshot,
          routeSnapshot,
          distanceMeters: 3_000,
          durationSeconds: 450,
          baseFeeMinor: breakdown.baseFeeMinor,
          distanceChargeMinor: breakdown.distanceChargeMinor,
          packageSurchargeMinor: breakdown.packageSurchargeMinor,
          weightSurchargeMinor: breakdown.weightSurchargeMinor,
          fragileSurchargeMinor: breakdown.fragileSurchargeMinor,
          thermalBagSurchargeMinor: breakdown.thermalBagSurchargeMinor,
          discountMinor: 0,
          surgeAdjustmentMinor: 0,
          taxMinor: 0,
          merchantTotalMinor: breakdown.merchantTotalMinor,
          estimatedCourierEarningMinor: breakdown.estimatedCourierEarningMinor,
          platformCommissionMinor: breakdown.platformCommissionMinor,
          platformCommissionBasisPoints:
            breakdown.platformCommissionBasisPoints,
          currency: 'EGP',
          breakdown,
          requestFingerprint: demo.orderId
            .replaceAll('-', '')
            .padEnd(64, '0')
            .slice(0, 64),
          idempotencyKey: `seed-phase3-${demo.orderNumber}`,
          expiresAt: new Date('2099-12-31T23:59:59.000Z'),
          consumedAt: demo.occurredAt,
          createdAt: demo.occurredAt,
        },
      });
    }
    const order = await prisma.deliveryOrder.findUnique({
      where: { id: demo.orderId },
      select: { id: true },
    });
    if (!order) {
      await prisma.deliveryOrder.create({
        data: {
          id: demo.orderId,
          orderNumber: demo.orderNumber,
          quoteId: demo.quoteId,
          merchantId: ids.merchant,
          storeId: ids.store,
          customerId: ids.customerOne,
          pickupAddressId: ids.pickupAddress,
          dropoffAddressId: ids.dropoffOne,
          serviceZoneId: ids.serviceZone,
          pricingRuleId: ids.pricingRulePhaseThree,
          createdById: ids.owner,
          courierId: demo.courierId,
          status: demo.status,
          acceptanceExpiresAt:
            demo.status === 'SEARCHING_COURIER'
              ? demoAcceptanceExpiresAt
              : null,
          dispatchAttemptCount: 1,
          customerSnapshot,
          pickupAddressSnapshot,
          dropoffAddressSnapshot,
          packageSnapshot,
          routeSnapshot,
          pricingSnapshot: breakdown,
          packageCategory: packageSnapshot.category,
          itemDescription: packageSnapshot.itemDescription,
          packageSize: 'MEDIUM',
          weightGrams: packageSnapshot.weightGrams,
          packageCount: 1,
          fragile: true,
          requiresThermalBag: false,
          recipientNotes: packageSnapshot.recipientNotes,
          courierNotes: packageSnapshot.courierNotes,
          declaredValueMinor: packageSnapshot.declaredValueMinor,
          prohibitedItemsConfirmed: true,
          merchantReference: packageSnapshot.merchantReference,
          routeDistanceMeters: 3_000,
          estimatedDurationSeconds: 450,
          baseFeeMinor: breakdown.baseFeeMinor,
          distanceChargeMinor: breakdown.distanceChargeMinor,
          packageSurchargeMinor: breakdown.packageSurchargeMinor,
          weightSurchargeMinor: breakdown.weightSurchargeMinor,
          fragileSurchargeMinor: breakdown.fragileSurchargeMinor,
          thermalBagSurchargeMinor: breakdown.thermalBagSurchargeMinor,
          merchantTotalMinor: breakdown.merchantTotalMinor,
          estimatedCourierEarningMinor: breakdown.estimatedCourierEarningMinor,
          platformCommissionMinor: breakdown.platformCommissionMinor,
          platformCommissionBasisPoints:
            breakdown.platformCommissionBasisPoints,
          currency: 'EGP',
          pricingVersion: 3,
          financialFinalizedAt:
            demo.status === 'COMPLETED' ? demo.occurredAt : null,
          createdAt: demo.occurredAt,
        },
      });
    } else if (demo.status === 'SEARCHING_COURIER') {
      await prisma.deliveryOrder.update({
        where: { id: demo.orderId },
        data: {
          status: 'SEARCHING_COURIER',
          courierId: null,
          acceptanceExpiresAt: demoAcceptanceExpiresAt,
          dispatchAttemptCount: 1,
        },
      });
    }
  }

  await prisma.orderEvent.createMany({
    data: [
      {
        id: '8b000000-0000-4000-8000-000000000001',
        orderId: ids.phaseThreeOrderAvailable,
        eventType: 'COURIER_SEARCH_REQUESTED',
        fromStatus: 'QUOTED',
        toStatus: 'SEARCHING_COURIER',
        actorType: 'SYSTEM',
        source: 'SYSTEM',
        merchantMessage: 'الطلب متاح للمندوبين المؤهلين.',
      },
      {
        id: '8b000000-0000-4000-8000-000000000002',
        orderId: ids.phaseThreeOrderAssigned,
        eventType: 'COURIER_ACCEPTED',
        fromStatus: 'SEARCHING_COURIER',
        toStatus: 'COURIER_ASSIGNED',
        actorType: 'USER',
        actorId: ids.approvedUserTwo,
        actorRole: 'COURIER',
        source: 'COURIER_MOBILE',
        merchantMessage: 'قبل المندوب الطلب.',
      },
      ...[
        {
          orderId: ids.phaseThreeOrderOverdue,
          actorId: ids.approvedUser,
          returned: false,
        },
        {
          orderId: ids.phaseThreeOrderPartial,
          actorId: ids.approvedUserTwo,
          returned: false,
        },
        {
          orderId: ids.phaseThreeOrderPaidReturn,
          actorId: ids.approvedUserThree,
          returned: true,
        },
        {
          orderId: ids.phaseThreeOrderOpen,
          actorId: ids.approvedUser,
          returned: false,
        },
      ].flatMap((entry, index) => [
        {
          id: `8c00000${index + 1}-0000-4000-8000-000000000001`,
          orderId: entry.orderId,
          eventType: 'COURIER_ACCEPTED' as const,
          fromStatus: 'SEARCHING_COURIER' as const,
          toStatus: 'COURIER_ASSIGNED' as const,
          actorType: 'USER' as const,
          actorId: entry.actorId,
          actorRole: 'COURIER' as const,
          source: 'COURIER_MOBILE' as const,
          merchantMessage: 'قبل المندوب الطلب.',
        },
        ...(entry.returned
          ? [
              {
                id: `8c00000${index + 1}-0000-4000-8000-000000000002`,
                orderId: entry.orderId,
                eventType: 'ORDER_RETURNED' as const,
                fromStatus: 'RETURNING_TO_STORE' as const,
                toStatus: 'RETURNED' as const,
                actorType: 'USER' as const,
                actorId: entry.actorId,
                actorRole: 'COURIER' as const,
                source: 'COURIER_MOBILE' as const,
                merchantMessage: 'أعيد الطلب إلى المتجر.',
              },
            ]
          : []),
        {
          id: `8c00000${index + 1}-0000-4000-8000-000000000003`,
          orderId: entry.orderId,
          eventType: 'ORDER_COMPLETED' as const,
          fromStatus: entry.returned
            ? ('RETURNED' as const)
            : ('DELIVERED' as const),
          toStatus: 'COMPLETED' as const,
          actorType: 'USER' as const,
          actorId: entry.actorId,
          actorRole: 'COURIER' as const,
          source: 'COURIER_MOBILE' as const,
          merchantMessage: 'اكتمل الطلب مالياً.',
        },
      ]),
    ],
    skipDuplicates: true,
  });

  const ledgerEntries = [
    {
      id: '8d000000-0000-4000-8000-000000000001',
      courierId: ids.approvedCourier,
      orderId: ids.phaseThreeOrderOverdue,
      sourceKey: `order:${ids.phaseThreeOrderOverdue}:commission`,
      occurredAt: new Date('2026-07-01T09:00:00.000Z'),
    },
    {
      id: '8d000000-0000-4000-8000-000000000002',
      courierId: ids.approvedCourierTwo,
      orderId: ids.phaseThreeOrderPartial,
      sourceKey: `order:${ids.phaseThreeOrderPartial}:commission`,
      occurredAt: new Date('2026-07-15T09:00:00.000Z'),
    },
    {
      id: '8d000000-0000-4000-8000-000000000003',
      courierId: ids.approvedCourierThree,
      orderId: ids.phaseThreeOrderPaidReturn,
      sourceKey: `order:${ids.phaseThreeOrderPaidReturn}:commission`,
      occurredAt: new Date('2026-07-08T09:00:00.000Z'),
    },
    {
      id: '8d000000-0000-4000-8000-000000000004',
      courierId: ids.approvedCourier,
      orderId: ids.phaseThreeOrderOpen,
      sourceKey: `order:${ids.phaseThreeOrderOpen}:commission`,
      occurredAt: new Date('2026-07-22T09:00:00.000Z'),
    },
  ];
  await prisma.courierLedgerEntry.createMany({
    data: ledgerEntries.map((entry) => ({
      ...entry,
      type: 'COMMISSION_DUE' as const,
      amountMinor: 590,
      currency: 'EGP',
      reason: 'Seeded Phase 3 completed-order commission.',
    })),
    skipDuplicates: true,
  });
  await prisma.courierLedgerEntry.createMany({
    data: [
      {
        id: '8d000000-0000-4000-8000-000000000005',
        courierId: ids.approvedCourier,
        type: 'ADJUSTMENT_DEBIT',
        amountMinor: 100,
        currency: 'EGP',
        sourceKey: 'seed-phase3-adjustment-debit',
        createdById: ids.superAdmin,
        reason: 'مثال تسوية مدينة.',
        occurredAt: new Date('2026-07-23T09:00:00.000Z'),
      },
      {
        id: '8d000000-0000-4000-8000-000000000006',
        courierId: ids.approvedCourier,
        type: 'WAIVER',
        amountMinor: -50,
        currency: 'EGP',
        sourceKey: 'seed-phase3-waiver',
        createdById: ids.superAdmin,
        reason: 'مثال إعفاء إداري.',
        occurredAt: new Date('2026-07-23T10:00:00.000Z'),
      },
    ],
    skipDuplicates: true,
  });

  const settlements = [
    {
      id: ids.settlementOverdue,
      courierId: ids.approvedCourier,
      periodStart: new Date('2026-06-28T21:00:00.000Z'),
      periodEnd: new Date('2026-07-05T21:00:00.000Z'),
      dueAt: new Date('2026-07-12T21:00:00.000Z'),
    },
    {
      id: ids.settlementPartial,
      courierId: ids.approvedCourierTwo,
      periodStart: new Date('2026-07-12T21:00:00.000Z'),
      periodEnd: new Date('2026-07-19T21:00:00.000Z'),
      dueAt: new Date('2026-07-26T21:00:00.000Z'),
    },
    {
      id: ids.settlementPaid,
      courierId: ids.approvedCourierThree,
      periodStart: new Date('2026-07-05T21:00:00.000Z'),
      periodEnd: new Date('2026-07-12T21:00:00.000Z'),
      dueAt: new Date('2026-07-19T21:00:00.000Z'),
    },
    {
      id: ids.settlementOpen,
      courierId: ids.approvedCourier,
      periodStart: new Date('2026-07-19T21:00:00.000Z'),
      periodEnd: new Date('2026-07-26T21:00:00.000Z'),
      dueAt: new Date('2026-08-02T21:00:00.000Z'),
    },
  ];
  for (const settlement of settlements) {
    const existing = await prisma.settlementPeriod.findUnique({
      where: { id: settlement.id },
      select: { id: true },
    });
    if (!existing) {
      await prisma.settlementPeriod.create({
        data: { ...settlement, currency: 'EGP' },
      });
    }
  }

  await prisma.settlementLine.createMany({
    data: [
      {
        id: '8e000000-0000-4000-8000-000000000001',
        settlementPeriodId: ids.settlementOverdue,
        ledgerEntryId: ledgerEntries[0]!.id,
        amountMinor: 590,
      },
      {
        id: '8e000000-0000-4000-8000-000000000002',
        settlementPeriodId: ids.settlementPartial,
        ledgerEntryId: ledgerEntries[1]!.id,
        amountMinor: 590,
      },
      {
        id: '8e000000-0000-4000-8000-000000000003',
        settlementPeriodId: ids.settlementPaid,
        ledgerEntryId: ledgerEntries[2]!.id,
        amountMinor: 590,
      },
      {
        id: '8e000000-0000-4000-8000-000000000004',
        settlementPeriodId: ids.settlementOpen,
        ledgerEntryId: ledgerEntries[3]!.id,
        amountMinor: 590,
      },
      {
        id: '8e000000-0000-4000-8000-000000000005',
        settlementPeriodId: ids.settlementOpen,
        ledgerEntryId: '8d000000-0000-4000-8000-000000000005',
        amountMinor: 100,
      },
      {
        id: '8e000000-0000-4000-8000-000000000006',
        settlementPeriodId: ids.settlementOpen,
        ledgerEntryId: '8d000000-0000-4000-8000-000000000006',
        amountMinor: -50,
      },
    ],
    skipDuplicates: true,
  });

  const payments = [
    {
      id: ids.paymentPartial,
      courierId: ids.approvedCourierTwo,
      amountMinor: 300,
      paidAt: new Date('2026-07-21T10:00:00.000Z'),
      idempotencyKey: 'seed-phase3-partial-payment',
      settlementPeriodId: ids.settlementPartial,
    },
    {
      id: ids.paymentPaid,
      courierId: ids.approvedCourierThree,
      amountMinor: 590,
      paidAt: new Date('2026-07-14T10:00:00.000Z'),
      idempotencyKey: 'seed-phase3-paid-payment',
      settlementPeriodId: ids.settlementPaid,
    },
  ];
  for (const payment of payments) {
    const existing = await prisma.externalPaymentRecord.findUnique({
      where: { id: payment.id },
      select: { id: true },
    });
    if (!existing) {
      await prisma.externalPaymentRecord.create({
        data: {
          id: payment.id,
          courierId: payment.courierId,
          amountMinor: payment.amountMinor,
          currency: 'EGP',
          paidAt: payment.paidAt,
          method: 'CASH',
          externalReference: `DEMO-${payment.id.slice(-4)}`,
          note: 'دفعة خارجية تجريبية.',
          createdById: ids.financeAdmin,
          idempotencyKey: payment.idempotencyKey,
        },
      });
    }
  }
  await prisma.externalPaymentAllocation.createMany({
    data: payments.map((payment, index) => ({
      id: `8f00000${index + 1}-0000-4000-8000-000000000001`,
      paymentId: payment.id,
      settlementPeriodId: payment.settlementPeriodId,
      amountMinor: payment.amountMinor,
    })),
    skipDuplicates: true,
  });
  await prisma.courierLedgerEntry.createMany({
    data: payments.map((payment, index) => ({
      id: `8f00000${index + 1}-0000-4000-8000-000000000002`,
      courierId: payment.courierId,
      type: 'EXTERNAL_PAYMENT' as const,
      amountMinor: -payment.amountMinor,
      currency: 'EGP',
      sourceKey: `payment:${payment.id}`,
      createdById: ids.financeAdmin,
      reason: 'Seeded external payment.',
      metadata: { kind: 'external_payment', paymentId: payment.id },
      occurredAt: payment.paidAt,
    })),
    skipDuplicates: true,
  });

  await prisma.settlementPeriod.update({
    where: { id: ids.settlementOverdue },
    data: {
      totalCommissionDueMinor: 590,
      totalPaymentsMinor: 0,
      totalAdjustmentsMinor: 0,
      totalWaivedMinor: 0,
      remainingAmountMinor: 590,
      status: 'OVERDUE',
      closedAt: new Date('2026-07-05T21:00:00.000Z'),
    },
  });
  await prisma.settlementPeriod.update({
    where: { id: ids.settlementPartial },
    data: {
      totalCommissionDueMinor: 590,
      totalPaymentsMinor: 300,
      totalAdjustmentsMinor: 0,
      totalWaivedMinor: 0,
      remainingAmountMinor: 290,
      status: 'PARTIALLY_PAID',
      closedAt: new Date('2026-07-19T21:00:00.000Z'),
    },
  });
  await prisma.settlementPeriod.update({
    where: { id: ids.settlementPaid },
    data: {
      totalCommissionDueMinor: 590,
      totalPaymentsMinor: 590,
      totalAdjustmentsMinor: 0,
      totalWaivedMinor: 0,
      remainingAmountMinor: 0,
      status: 'PAID',
      closedAt: new Date('2026-07-12T21:00:00.000Z'),
    },
  });
  await prisma.settlementPeriod.update({
    where: { id: ids.settlementOpen },
    data: {
      totalCommissionDueMinor: 590,
      totalPaymentsMinor: 0,
      totalAdjustmentsMinor: 100,
      totalWaivedMinor: 50,
      remainingAmountMinor: 640,
      status: 'OPEN',
      closedAt: null,
    },
  });

  await prisma.courierProfile.update({
    where: { id: ids.approvedCourier },
    data: { completedOrdersCount: 2 },
  });
  await prisma.courierProfile.update({
    where: { id: ids.approvedCourierTwo },
    data: { completedOrdersCount: 1 },
  });
  await prisma.courierProfile.update({
    where: { id: ids.approvedCourierThree },
    data: { completedOrdersCount: 1 },
  });
}

async function seedPhaseFourOperations(): Promise<void> {
  await prisma.platformOperationalSetting.upsert({
    where: { version: 1 },
    update: {
      deliveryDisputeWindowHours: 24,
      returnConfirmationTimeoutHours: 48,
      notificationRetentionDays: 90,
      operationsTimezone: 'Africa/Cairo',
    },
    create: {
      id: ids.operationalSettings,
      deliveryDisputeWindowHours: 24,
      returnConfirmationTimeoutHours: 48,
      notificationRetentionDays: 90,
      operationsTimezone: 'Africa/Cairo',
      effectiveFrom: new Date('2026-07-27T00:00:00.000Z'),
      version: 1,
      createdById: ids.superAdmin,
    },
  });

  await prisma.address.update({
    where: { id: ids.dropoffOne },
    data: {
      street: 'شارع صناعي تجريبي',
      deliveryNotes: 'تفاصيل اختيارية لتجربة الوصول فقط.',
      sourceMapsUrl:
        'https://www.google.com/maps/place/Damietta/@31.4321,31.8273,16z',
    },
  });

  const sourceQuote = await prisma.priceQuote.findUniqueOrThrow({
    where: { id: ids.phaseThreeQuoteAvailable },
  });
  const sourceOrder = await prisma.deliveryOrder.findUniqueOrThrow({
    where: { id: ids.phaseThreeOrderAvailable },
  });
  const structuredDropoff = {
    ...(sourceQuote.dropoffAddressSnapshot as Record<string, unknown>),
    street: 'شارع صناعي تجريبي',
    buildingNumber: '25',
    floor: '2',
    apartment: '4',
    landmark: 'بجوار علامة تجريبية',
    deliveryNotes: 'اتصل عند الوصول.',
    sourceMapsUrl:
      'https://www.google.com/maps/place/Damietta/@31.4321,31.8273,16z',
  };

  async function ensureQuote(
    id: string,
    key: string,
    status: 'ACTIVE' | 'CONSUMED',
  ) {
    const current = await prisma.priceQuote.findUnique({ where: { id } });
    if (current) return current;
    const {
      id: _sourceId,
      idempotencyKey: _sourceKey,
      requestFingerprint: _sourceFingerprint,
      status: _sourceStatus,
      consumedAt: _sourceConsumedAt,
      version: _sourceVersion,
      createdAt: _sourceCreatedAt,
      ...base
    } = sourceQuote;
    return prisma.priceQuote.create({
      data: {
        ...base,
        id,
        status,
        dropoffAddressSnapshot: structuredDropoff,
        requestFingerprint: createHash('sha256').update(key).digest('hex'),
        idempotencyKey: key,
        expiresAt: new Date('2099-12-31T23:59:59.000Z'),
        consumedAt:
          status === 'CONSUMED' ? new Date('2026-07-27T08:00:00.000Z') : null,
        version: 1,
        createdAt: new Date('2026-07-27T08:00:00.000Z'),
      },
    });
  }

  await ensureQuote(
    ids.phaseFourQuoteReview,
    'seed-phase4-location-review',
    'ACTIVE',
  );

  async function ensureOrder(input: {
    quoteId: string;
    orderId: string;
    orderNumber: string;
    status:
      | 'DELIVERED'
      | 'DELIVERY_DISPUTED'
      | 'DELIVERY_FAILED'
      | 'RETURN_AWAITING_MERCHANT_CONFIRMATION';
    courierId: string;
    deliveredAt?: Date;
    deadline?: Date;
    failure?: boolean;
    returnReportedAt?: Date;
  }) {
    await ensureQuote(
      input.quoteId,
      `seed-phase4-${input.orderNumber}`,
      'CONSUMED',
    );
    const existing = await prisma.deliveryOrder.findUnique({
      where: { id: input.orderId },
    });
    if (existing) return existing;
    const {
      id: _sourceId,
      orderNumber: _sourceNumber,
      quoteId: _sourceQuoteId,
      courierId: _sourceCourier,
      status: _sourceStatus,
      dropoffAddressSnapshot: _sourceDropoff,
      version: _sourceVersion,
      createdAt: _sourceCreatedAt,
      updatedAt: _sourceUpdatedAt,
      ...base
    } = sourceOrder;
    return prisma.deliveryOrder.create({
      data: {
        ...base,
        id: input.orderId,
        orderNumber: input.orderNumber,
        quoteId: input.quoteId,
        courierId: input.courierId,
        status: input.status,
        dropoffAddressSnapshot: structuredDropoff,
        deliveredAt: input.deliveredAt,
        deliveryDisputeDeadlineAt: input.deadline,
        deliveryFailureReason: input.failure ? 'CUSTOMER_NO_ANSWER' : undefined,
        deliveryFailureNote: input.failure
          ? 'تعذر التواصل مع العميل في السيناريو التجريبي.'
          : undefined,
        returnReportedAt: input.returnReportedAt,
        financialFinalizedAt: null,
        version: 1,
        createdAt: new Date('2026-07-27T08:00:00.000Z'),
      },
    });
  }

  await ensureOrder({
    quoteId: ids.phaseFourQuoteDelivered,
    orderId: ids.phaseFourOrderDelivered,
    orderNumber: 'WSL-PH4-DELIVERED',
    status: 'DELIVERED',
    courierId: ids.approvedCourier,
    deliveredAt: new Date('2026-07-27T09:00:00.000Z'),
    deadline: new Date('2026-07-28T09:00:00.000Z'),
  });
  await ensureOrder({
    quoteId: ids.phaseFourQuotePast,
    orderId: ids.phaseFourOrderPast,
    orderNumber: 'WSL-PH4-DEADLINE',
    status: 'DELIVERED',
    courierId: ids.approvedCourierTwo,
    deliveredAt: new Date('2026-07-25T08:00:00.000Z'),
    deadline: new Date('2026-07-26T08:00:00.000Z'),
  });
  await ensureOrder({
    quoteId: ids.phaseFourQuoteDisputed,
    orderId: ids.phaseFourOrderDisputed,
    orderNumber: 'WSL-PH4-DISPUTE',
    status: 'DELIVERY_DISPUTED',
    courierId: ids.approvedCourier,
    deliveredAt: new Date('2026-07-27T07:00:00.000Z'),
    deadline: new Date('2026-07-28T07:00:00.000Z'),
  });
  await ensureOrder({
    quoteId: ids.phaseFourQuoteFailed,
    orderId: ids.phaseFourOrderFailed,
    orderNumber: 'WSL-PH4-FAILED',
    status: 'DELIVERY_FAILED',
    courierId: ids.approvedCourierTwo,
    failure: true,
  });
  await ensureOrder({
    quoteId: ids.phaseFourQuoteReturnAwaiting,
    orderId: ids.phaseFourOrderReturnAwaiting,
    orderNumber: 'WSL-PH4-RETURN-WAIT',
    status: 'RETURN_AWAITING_MERCHANT_CONFIRMATION',
    courierId: ids.approvedCourierThree,
    failure: true,
    returnReportedAt: new Date('2026-07-27T06:00:00.000Z'),
  });

  await prisma.deliveryDispute.upsert({
    where: { orderId: ids.phaseFourOrderDisputed },
    update: {},
    create: {
      id: ids.phaseFourOpenDispute,
      orderId: ids.phaseFourOrderDisputed,
      merchantId: ids.merchant,
      courierId: ids.approvedCourier,
      status: 'COURIER_RESPONDED',
      merchantReason: 'CUSTOMER_DID_NOT_RECEIVE',
      merchantNote: 'العميل يقول إن الطلب لم يصله.',
      createdById: ids.owner,
      courierResponse: 'وصلت إلى العنوان المسجل وسلمت الطلب.',
      paperProofAvailable: true,
      courierRespondedAt: new Date('2026-07-27T08:00:00.000Z'),
      createdAt: new Date('2026-07-27T07:30:00.000Z'),
    },
  });
  await prisma.deliveryDispute.upsert({
    where: { orderId: ids.phaseThreeOrderOpen },
    update: {},
    create: {
      id: ids.phaseFourResolvedDispute,
      orderId: ids.phaseThreeOrderOpen,
      merchantId: ids.merchant,
      courierId: ids.approvedCourier,
      status: 'RESOLVED_DELIVERY_CONFIRMED',
      merchantReason: 'MARKED_DELIVERED_BY_MISTAKE',
      merchantNote: 'سيناريو اعتراض محسوم للتجربة.',
      createdById: ids.manager,
      resolutionNote: 'أكدت العمليات صحة التسليم.',
      resolvedById: ids.operationsAdmin,
      resolvedAt: new Date('2026-07-24T10:00:00.000Z'),
      createdAt: new Date('2026-07-24T09:00:00.000Z'),
    },
  });

  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfkcAAAAASUVORK5CYII=',
    'base64',
  );
  const storageRoot = resolve(process.env.STORAGE_LOCAL_DIR ?? '.data/uploads');
  const proofDirectory = resolve(
    storageRoot,
    'payment-proofs',
    ids.approvedCourierTwo,
  );
  await mkdir(proofDirectory, { recursive: true });
  const checksum = createHash('sha256').update(pngBytes).digest('hex');
  const proofSeeds = [
    {
      id: ids.phaseFourProofPending,
      status: 'PENDING_CONFIRMATION' as const,
      amount: 1_000,
      approved: null,
      reference: 'PH4-PENDING-001',
      paymentId: null,
      reason: null,
    },
    {
      id: ids.phaseFourProofPartial,
      status: 'PARTIALLY_APPROVED' as const,
      amount: 500,
      approved: 300,
      reference: 'PH4-PARTIAL-002',
      paymentId: ids.paymentPartial,
      reason: 'اعتمدت المالية المبلغ الظاهر فقط.',
    },
    {
      id: ids.phaseFourProofRejected,
      status: 'REJECTED' as const,
      amount: 700,
      approved: null,
      reference: 'PH4-REJECTED-003',
      paymentId: null,
      reason: 'الصورة غير واضحة.',
    },
  ];
  for (const proof of proofSeeds) {
    const storageKey = `payment-proofs/${ids.approvedCourierTwo}/${proof.id}`;
    await writeFile(resolve(storageRoot, storageKey), pngBytes);
    await prisma.courierPaymentProof.upsert({
      where: { id: proof.id },
      update: {
        status: proof.status,
        approvedAmountMinor: proof.approved,
        reviewReason: proof.reason,
        linkedExternalPaymentId: proof.paymentId,
      },
      create: {
        id: proof.id,
        courierId: ids.approvedCourierTwo,
        submittedAmountMinor: proof.amount,
        approvedAmountMinor: proof.approved,
        method: 'BANK_TRANSFER',
        paidAt: new Date('2026-07-26T10:00:00.000Z'),
        externalReference: proof.reference,
        normalizedReference: proof.reference.replaceAll('-', ''),
        status: proof.status,
        storageKey,
        originalFilename: `${proof.reference}.png`,
        contentType: 'image/png',
        sizeBytes: pngBytes.byteLength,
        checksumSha256: checksum,
        duplicateIndicators: {
          warningOnly: true,
          checksumMatch: proof.id !== ids.phaseFourProofPending,
        },
        reviewReason: proof.reason,
        reviewedById:
          proof.status === 'PENDING_CONFIRMATION' ? null : ids.financeAdmin,
        reviewedAt:
          proof.status === 'PENDING_CONFIRMATION'
            ? null
            : new Date('2026-07-27T05:00:00.000Z'),
        linkedExternalPaymentId: proof.paymentId,
        idempotencyKey: `seed-${proof.id}`,
      },
    });
  }

  await prisma.paymentProofReview.createMany({
    data: [
      {
        id: '96000000-0000-4000-8000-000000000001',
        paymentProofId: ids.phaseFourProofPartial,
        actorId: ids.financeAdmin,
        fromStatus: 'PENDING_CONFIRMATION',
        toStatus: 'PARTIALLY_APPROVED',
        approvedAmountMinor: 300,
        reason: 'اعتمدت المالية المبلغ الظاهر فقط.',
        metadata: { externalPaymentId: ids.paymentPartial },
      },
      {
        id: '96000000-0000-4000-8000-000000000002',
        paymentProofId: ids.phaseFourProofRejected,
        actorId: ids.financeAdmin,
        fromStatus: 'PENDING_CONFIRMATION',
        toStatus: 'REJECTED',
        reason: 'الصورة غير واضحة.',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.notification.createMany({
    data: [
      {
        id: '97000000-0000-4000-8000-000000000001',
        recipientUserId: ids.owner,
        type: 'ORDER_DELIVERED',
        title: 'تم الإبلاغ عن التسليم',
        body: 'راجع الطلب خلال نافذة الاعتراض البالغة 24 ساعة.',
        relatedEntityType: 'DeliveryOrder',
        relatedEntityId: ids.phaseFourOrderDelivered,
        deepLink: `/orders/${ids.phaseFourOrderDelivered}`,
        deduplicationKey: 'seed-phase4-owner-delivered',
      },
      {
        id: '97000000-0000-4000-8000-000000000002',
        recipientUserId: ids.approvedUser,
        type: 'DELIVERY_DISPUTE_CREATED',
        title: 'اعتراض توصيل مفتوح',
        body: 'أرسل ردك من الطلب الحالي.',
        relatedEntityType: 'DeliveryDispute',
        relatedEntityId: ids.phaseFourOpenDispute,
        deepLink: `/orders/${ids.phaseFourOrderDisputed}`,
        deduplicationKey: 'seed-phase4-courier-dispute',
      },
      {
        id: '97000000-0000-4000-8000-000000000003',
        recipientUserId: ids.financeAdmin,
        type: 'PAYMENT_PROOF_PENDING',
        title: 'إثبات دفع ينتظر المراجعة',
        body: 'راجع الصورة والمبلغ ومؤشرات التشابه.',
        relatedEntityType: 'CourierPaymentProof',
        relatedEntityId: ids.phaseFourProofPending,
        deepLink: `/payment-proofs/${ids.phaseFourProofPending}`,
        deduplicationKey: 'seed-phase4-finance-proof',
      },
    ],
    skipDuplicates: true,
  });
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
    sequence: 5,
    userId: ids.approvedUserTwo,
    courierId: ids.approvedCourierTwo,
    fullName: 'مندوب معتمد ثانٍ',
    status: 'APPROVED',
    documentStatus: 'APPROVED',
  });
  await seedCourier({
    sequence: 6,
    userId: ids.approvedUserThree,
    courierId: ids.approvedCourierThree,
    fullName: 'مندوب معتمد ثالث',
    status: 'APPROVED',
    documentStatus: 'APPROVED',
  });
  await seedCourier({
    sequence: 7,
    userId: ids.suspendedUser,
    courierId: ids.suspendedCourier,
    fullName: 'مندوب موقوف تجريبي',
    status: 'SUSPENDED',
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
  await seedPhaseTwoConfiguration();
  await seedPhaseThreeConfiguration();
  await seedPhaseTwoCustomersAndAddresses();
  await seedPhaseTwoQuotesAndOrders();
  await seedPhaseThreeMarketplaceAndAccounting();
  await seedPhaseFourOperations();
  console.info(
    'Seeded WASSAL Phase 1-4 identities, reviewed locations, disputes, returns, notifications, proofs, and accounting scenarios.',
  );
  console.info(
    'Pilot passwords: MerchantDemo123, CourierDemo123, AdminDemo123. OTP is deferred for public launch; no real personal data is present.',
  );
}

seed()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
