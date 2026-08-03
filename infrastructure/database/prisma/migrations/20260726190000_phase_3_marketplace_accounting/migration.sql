-- WASSAL Phase 3: courier-selected marketplace and offline commission accounting.
-- Existing Phase 1/2 operational and snapshot data is preserved.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_ACCEPTED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_ARRIVING_PICKUP';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_ARRIVED_PICKUP';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ORDER_PICKED_UP';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ORDER_IN_TRANSIT';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_ARRIVED_DROPOFF';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ORDER_DELIVERED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ORDER_COMPLETED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'RETURNING_TO_STORE';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ORDER_RETURNED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_CANCELLED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ADMIN_CANCELLED';

ALTER TYPE "OrderEventSource" ADD VALUE IF NOT EXISTS 'COURIER_MOBILE';
ALTER TYPE "OrderEventSource" ADD VALUE IF NOT EXISTS 'WORKER';

DO $$ BEGIN
  CREATE TYPE "SettlementCycleType" AS ENUM ('WEEKLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CourierLedgerEntryType" AS ENUM (
    'COMMISSION_DUE',
    'EXTERNAL_PAYMENT',
    'ADJUSTMENT_DEBIT',
    'ADJUSTMENT_CREDIT',
    'WAIVER',
    'REVERSAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CourierSettlementStatus" AS ENUM (
    'OPEN',
    'CLOSED',
    'NOT_DUE',
    'DUE_SOON',
    'PARTIALLY_PAID',
    'PAID',
    'OVERDUE',
    'WAIVED',
    'ADJUSTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExternalPaymentMethod" AS ENUM (
    'CASH',
    'BANK_TRANSFER',
    'MOBILE_WALLET_EXTERNAL',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Phase 2 made quote/order snapshots immutable. Temporarily remove those two
-- triggers so this migration can add and backfill the new immutable commission
-- rate column; the expanded trigger is restored below in the same transaction.
DROP TRIGGER IF EXISTS "PriceQuote_snapshot_immutable" ON "PriceQuote";
DROP TRIGGER IF EXISTS "DeliveryOrder_snapshot_immutable" ON "DeliveryOrder";

ALTER TABLE "PriceQuote"
  ADD COLUMN IF NOT EXISTS "platformCommissionBasisPoints" INTEGER;

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "platformCommissionBasisPoints" INTEGER,
  ADD COLUMN IF NOT EXISTS "financialFinalizedAt" TIMESTAMPTZ(3);

-- Backfill the exact historical percentage where possible. Fixed legacy rules
-- retain their exact amount and receive a derived informational rate.
UPDATE "PriceQuote" AS quote
SET "platformCommissionBasisPoints" = LEAST(
  10000,
  GREATEST(
    0,
    COALESCE(
      CASE
        WHEN rule."commissionType" = 'PERCENTAGE' THEN rule."commissionValue"
        ELSE NULL
      END,
      CASE
        WHEN quote."merchantTotalMinor" = 0 THEN 0
        ELSE ROUND(
          quote."platformCommissionMinor"::numeric * 10000
          / quote."merchantTotalMinor"::numeric
        )::integer
      END
    )
  )
)
FROM "PricingRule" AS rule
WHERE rule."id" = quote."pricingRuleId";

UPDATE "DeliveryOrder" AS delivery
SET "platformCommissionBasisPoints" = LEAST(
  10000,
  GREATEST(
    0,
    COALESCE(
      CASE
        WHEN rule."commissionType" = 'PERCENTAGE' THEN rule."commissionValue"
        ELSE NULL
      END,
      CASE
        WHEN delivery."merchantTotalMinor" = 0 THEN 0
        ELSE ROUND(
          delivery."platformCommissionMinor"::numeric * 10000
          / delivery."merchantTotalMinor"::numeric
        )::integer
      END
    )
  )
)
FROM "PricingRule" AS rule
WHERE rule."id" = delivery."pricingRuleId";

ALTER TABLE "PriceQuote"
  ALTER COLUMN "platformCommissionBasisPoints" SET NOT NULL,
  ADD CONSTRAINT "PriceQuote_commission_basis_points_check"
    CHECK ("platformCommissionBasisPoints" BETWEEN 0 AND 10000);

ALTER TABLE "DeliveryOrder"
  ALTER COLUMN "platformCommissionBasisPoints" SET NOT NULL,
  DROP CONSTRAINT "DeliveryOrder_phase2_scope_check",
  ADD CONSTRAINT "DeliveryOrder_commission_basis_points_check"
    CHECK ("platformCommissionBasisPoints" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "DeliveryOrder_phase3_scope_check"
    CHECK (
      "paymentMode" = 'DELIVERY_ONLY'
      AND "prohibitedItemsConfirmed" = true
      AND (
        (
          "status"::text IN ('DRAFT', 'QUOTED', 'SEARCHING_COURIER', 'CANCELLED')
          AND "courierId" IS NULL
        )
        OR (
          "status"::text IN (
            'COURIER_ASSIGNED',
            'COURIER_ARRIVING_PICKUP',
            'AT_PICKUP',
            'PICKED_UP',
            'IN_TRANSIT',
            'AT_DROPOFF',
            'DELIVERED',
            'DELIVERY_FAILED',
            'RETURNING_TO_STORE',
            'RETURNED',
            'COMPLETED'
          )
          AND "courierId" IS NOT NULL
        )
      )
      AND (
        ("status"::text = 'COMPLETED' AND "financialFinalizedAt" IS NOT NULL)
        OR ("status"::text <> 'COMPLETED' AND "financialFinalizedAt" IS NULL)
      )
    );

CREATE TABLE "PlatformFinancialSetting" (
  "id" UUID NOT NULL,
  "defaultCommissionBasisPoints" INTEGER NOT NULL,
  "settlementCycle" "SettlementCycleType" NOT NULL DEFAULT 'WEEKLY',
  "gracePeriodDays" INTEGER NOT NULL DEFAULT 7,
  "operationsTimezone" VARCHAR(100) NOT NULL DEFAULT 'Africa/Cairo',
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformFinancialSetting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformFinancialSetting_values_check" CHECK (
    "defaultCommissionBasisPoints" BETWEEN 0 AND 10000
    AND "gracePeriodDays" BETWEEN 0 AND 60
    AND "operationsTimezone" = 'Africa/Cairo'
  )
);

CREATE UNIQUE INDEX "PlatformFinancialSetting_version_key"
  ON "PlatformFinancialSetting"("version");
CREATE INDEX "PlatformFinancialSetting_effectiveFrom_version_idx"
  ON "PlatformFinancialSetting"("effectiveFrom", "version");
ALTER TABLE "PlatformFinancialSetting"
  ADD CONSTRAINT "PlatformFinancialSetting_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PlatformFinancialSetting" (
  "id",
  "defaultCommissionBasisPoints",
  "settlementCycle",
  "gracePeriodDays",
  "operationsTimezone",
  "effectiveFrom",
  "version"
)
VALUES (
  '90000000-0000-4000-8000-000000000001',
  2000,
  'WEEKLY',
  7,
  'Africa/Cairo',
  TIMESTAMPTZ '2026-07-26 00:00:00+00',
  1
);

CREATE TABLE "CourierServiceZone" (
  "id" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "serviceZoneId" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CourierServiceZone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierServiceZone_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "CourierServiceZone_courierId_serviceZoneId_key"
  ON "CourierServiceZone"("courierId", "serviceZoneId");
CREATE INDEX "CourierServiceZone_serviceZoneId_active_courierId_idx"
  ON "CourierServiceZone"("serviceZoneId", "active", "courierId");
CREATE INDEX "CourierServiceZone_courierId_active_idx"
  ON "CourierServiceZone"("courierId", "active");
ALTER TABLE "CourierServiceZone"
  ADD CONSTRAINT "CourierServiceZone_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierServiceZone_serviceZoneId_fkey"
  FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierServiceZone_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Approved couriers receive explicit memberships matching their existing
-- preferred city. The deterministic seed will maintain richer demo membership.
INSERT INTO "CourierServiceZone" (
  "id",
  "courierId",
  "serviceZoneId",
  "active",
  "version",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  courier."id",
  zone."id",
  true,
  1,
  CURRENT_TIMESTAMP
FROM "CourierProfile" AS courier
JOIN "ServiceZone" AS zone
  ON zone."city" = courier."preferredCity"
  AND zone."status" = 'ACTIVE'
WHERE courier."verificationStatus" = 'APPROVED'
ON CONFLICT ("courierId", "serviceZoneId") DO NOTHING;

CREATE TABLE "CourierLedgerEntry" (
  "id" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "orderId" UUID,
  "type" "CourierLedgerEntryType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
  "sourceKey" VARCHAR(160) NOT NULL,
  "reversesEntryId" UUID,
  "createdById" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourierLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierLedgerEntry_amount_sign_check" CHECK (
    "currency" = 'EGP'
    AND (
      ("type" = 'COMMISSION_DUE' AND "amountMinor" >= 0)
      OR ("type" = 'ADJUSTMENT_DEBIT' AND "amountMinor" > 0)
      OR (
        "type" IN ('EXTERNAL_PAYMENT', 'ADJUSTMENT_CREDIT', 'WAIVER')
        AND "amountMinor" < 0
      )
      OR ("type" = 'REVERSAL' AND "amountMinor" <> 0)
    )
  )
);

CREATE UNIQUE INDEX "CourierLedgerEntry_sourceKey_key"
  ON "CourierLedgerEntry"("sourceKey");
CREATE UNIQUE INDEX "CourierLedgerEntry_reversesEntryId_key"
  ON "CourierLedgerEntry"("reversesEntryId");
CREATE UNIQUE INDEX "CourierLedgerEntry_one_commission_per_order"
  ON "CourierLedgerEntry"("orderId")
  WHERE "type" = 'COMMISSION_DUE';
CREATE INDEX "CourierLedgerEntry_courierId_occurredAt_idx"
  ON "CourierLedgerEntry"("courierId", "occurredAt");
CREATE INDEX "CourierLedgerEntry_orderId_type_idx"
  ON "CourierLedgerEntry"("orderId", "type");
CREATE INDEX "CourierLedgerEntry_type_occurredAt_idx"
  ON "CourierLedgerEntry"("type", "occurredAt");
ALTER TABLE "CourierLedgerEntry"
  ADD CONSTRAINT "CourierLedgerEntry_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierLedgerEntry_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierLedgerEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierLedgerEntry_reversesEntryId_fkey"
  FOREIGN KEY ("reversesEntryId") REFERENCES "CourierLedgerEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SettlementPeriod" (
  "id" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
  "totalCommissionDueMinor" INTEGER NOT NULL DEFAULT 0,
  "totalPaymentsMinor" INTEGER NOT NULL DEFAULT 0,
  "totalAdjustmentsMinor" INTEGER NOT NULL DEFAULT 0,
  "totalWaivedMinor" INTEGER NOT NULL DEFAULT 0,
  "remainingAmountMinor" INTEGER NOT NULL DEFAULT 0,
  "status" "CourierSettlementStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "closedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SettlementPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementPeriod_date_check" CHECK (
    "periodStart" < "periodEnd"
    AND "periodEnd" <= "dueAt"
  ),
  CONSTRAINT "SettlementPeriod_projection_check" CHECK (
    "currency" = 'EGP'
    AND "totalCommissionDueMinor" >= 0
    AND "totalPaymentsMinor" >= 0
    AND "totalWaivedMinor" >= 0
    AND "remainingAmountMinor" >= 0
    AND "version" > 0
    AND "remainingAmountMinor" = GREATEST(
      0,
      "totalCommissionDueMinor" + "totalAdjustmentsMinor"
      - "totalWaivedMinor" - "totalPaymentsMinor"
    )
  ),
  CONSTRAINT "SettlementPeriod_close_state_check" CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL)
    OR ("status" <> 'OPEN' AND "closedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "SettlementPeriod_courierId_periodStart_periodEnd_key"
  ON "SettlementPeriod"("courierId", "periodStart", "periodEnd");
CREATE INDEX "SettlementPeriod_courierId_status_dueAt_idx"
  ON "SettlementPeriod"("courierId", "status", "dueAt");
CREATE INDEX "SettlementPeriod_status_dueAt_idx"
  ON "SettlementPeriod"("status", "dueAt");
ALTER TABLE "SettlementPeriod"
  ADD CONSTRAINT "SettlementPeriod_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SettlementLine" (
  "id" UUID NOT NULL,
  "settlementPeriodId" UUID NOT NULL,
  "ledgerEntryId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementLine_ledgerEntryId_key"
  ON "SettlementLine"("ledgerEntryId");
CREATE INDEX "SettlementLine_settlementPeriodId_createdAt_idx"
  ON "SettlementLine"("settlementPeriodId", "createdAt");
ALTER TABLE "SettlementLine"
  ADD CONSTRAINT "SettlementLine_settlementPeriodId_fkey"
  FOREIGN KEY ("settlementPeriodId") REFERENCES "SettlementPeriod"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SettlementLine_ledgerEntryId_fkey"
  FOREIGN KEY ("ledgerEntryId") REFERENCES "CourierLedgerEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ExternalPaymentRecord" (
  "id" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "method" "ExternalPaymentMethod" NOT NULL,
  "externalReference" VARCHAR(160),
  "note" TEXT,
  "createdById" UUID NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "reversesPaymentId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalPaymentRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalPaymentRecord_amount_currency_check" CHECK (
    "amountMinor" > 0 AND "currency" = 'EGP'
  )
);

CREATE UNIQUE INDEX "ExternalPaymentRecord_idempotencyKey_key"
  ON "ExternalPaymentRecord"("idempotencyKey");
CREATE UNIQUE INDEX "ExternalPaymentRecord_reversesPaymentId_key"
  ON "ExternalPaymentRecord"("reversesPaymentId");
CREATE INDEX "ExternalPaymentRecord_courierId_paidAt_idx"
  ON "ExternalPaymentRecord"("courierId", "paidAt");
CREATE INDEX "ExternalPaymentRecord_externalReference_idx"
  ON "ExternalPaymentRecord"("externalReference");
ALTER TABLE "ExternalPaymentRecord"
  ADD CONSTRAINT "ExternalPaymentRecord_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalPaymentRecord_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalPaymentRecord_reversesPaymentId_fkey"
  FOREIGN KEY ("reversesPaymentId") REFERENCES "ExternalPaymentRecord"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ExternalPaymentAllocation" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "settlementPeriodId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalPaymentAllocation_amount_check" CHECK ("amountMinor" > 0)
);

CREATE UNIQUE INDEX "ExternalPaymentAllocation_paymentId_settlementPeriodId_key"
  ON "ExternalPaymentAllocation"("paymentId", "settlementPeriodId");
CREATE INDEX "ExternalPaymentAllocation_settlementPeriodId_createdAt_idx"
  ON "ExternalPaymentAllocation"("settlementPeriodId", "createdAt");
ALTER TABLE "ExternalPaymentAllocation"
  ADD CONSTRAINT "ExternalPaymentAllocation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "ExternalPaymentRecord"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalPaymentAllocation_settlementPeriodId_fkey"
  FOREIGN KEY ("settlementPeriodId") REFERENCES "SettlementPeriod"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_phase3_payment_overallocation()
RETURNS trigger AS $$
DECLARE
  payment_amount integer;
  allocated_amount bigint;
BEGIN
  SELECT "amountMinor"
  INTO payment_amount
  FROM "ExternalPaymentRecord"
  WHERE "id" = NEW."paymentId"
  FOR UPDATE;

  SELECT COALESCE(SUM("amountMinor"), 0)
  INTO allocated_amount
  FROM "ExternalPaymentAllocation"
  WHERE "paymentId" = NEW."paymentId"
    AND "id" <> NEW."id";

  IF allocated_amount + NEW."amountMinor" > payment_amount THEN
    RAISE EXCEPTION 'external payment allocation exceeds payment amount'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExternalPaymentAllocation_no_overallocation"
  BEFORE INSERT OR UPDATE ON "ExternalPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION prevent_phase3_payment_overallocation();

-- Expand the Phase 2 immutable-order projection fields while preserving all
-- address, package, route, pricing, and commission snapshots.
CREATE OR REPLACE FUNCTION prevent_phase2_snapshot_mutation()
RETURNS trigger AS $$
DECLARE
  allowed_columns text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  allowed_columns := CASE TG_TABLE_NAME
    WHEN 'PriceQuote' THEN ARRAY['status', 'consumedAt', 'version']
    WHEN 'DeliveryOrder' THEN ARRAY[
      'courierId', 'status', 'financialFinalizedAt',
      'cancelledAt', 'cancellationReasonCode',
      'cancellationDetails', 'cancelledByRole', 'version', 'updatedAt'
    ]
    WHEN 'PricingRule' THEN ARRAY['status', 'updatedAt']
    ELSE ARRAY[]::text[]
  END;

  IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM
     (to_jsonb(OLD) - allowed_columns) THEN
    RAISE EXCEPTION '% historical fields are immutable', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PriceQuote_snapshot_immutable"
  BEFORE UPDATE OR DELETE ON "PriceQuote"
  FOR EACH ROW EXECUTE FUNCTION prevent_phase2_snapshot_mutation();

CREATE TRIGGER "DeliveryOrder_snapshot_immutable"
  BEFORE UPDATE OR DELETE ON "DeliveryOrder"
  FOR EACH ROW EXECUTE FUNCTION prevent_phase2_snapshot_mutation();

-- New financial source records are append-only. Corrections are compensating
-- ledger/payment records; settlement periods alone are mutable projections.
CREATE TRIGGER "PlatformFinancialSetting_immutable"
  BEFORE UPDATE OR DELETE ON "PlatformFinancialSetting"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

CREATE TRIGGER "CourierLedgerEntry_immutable"
  BEFORE UPDATE OR DELETE ON "CourierLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

CREATE TRIGGER "SettlementLine_immutable"
  BEFORE UPDATE OR DELETE ON "SettlementLine"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

CREATE TRIGGER "ExternalPaymentRecord_immutable"
  BEFORE UPDATE OR DELETE ON "ExternalPaymentRecord"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

CREATE TRIGGER "ExternalPaymentAllocation_immutable"
  BEFORE UPDATE OR DELETE ON "ExternalPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();
