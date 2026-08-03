ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'NO_COURIER_AVAILABLE';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'NO_COURIER_AVAILABLE_FINAL';

ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_SEARCH_EXPIRED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'COURIER_SEARCH_RESTARTED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'MERCHANT_CANCELLED_AFTER_PICKUP';

ALTER TABLE "DeliveryOrder"
  ADD COLUMN IF NOT EXISTS "acceptanceExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancelledById" UUID,
  ADD COLUMN IF NOT EXISTS "cancelledAfterPickup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cancellationChargeMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DeliveryOrder"
  DROP CONSTRAINT IF EXISTS "DeliveryOrder_phase4_scope_check",
  ADD CONSTRAINT "DeliveryOrder_phase4_scope_check"
    CHECK (
      "paymentMode" = 'DELIVERY_ONLY'
      AND "prohibitedItemsConfirmed" = true
      AND (
        (
          "status"::text IN (
            'DRAFT',
            'QUOTED',
            'SEARCHING_COURIER',
            'NO_COURIER_AVAILABLE',
            'NO_COURIER_AVAILABLE_FINAL',
            'CANCELLED'
          )
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
            'DELIVERY_DISPUTED',
            'DELIVERY_FAILED',
            'RETURNING_TO_STORE',
            'RETURN_AWAITING_MERCHANT_CONFIRMATION',
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

-- Extend the immutable-snapshot trigger before backfilling the new mutable
-- dispatch fields. Otherwise the historical trigger correctly rejects the
-- update because it does not yet recognize those columns.
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
      'courierId', 'status', 'acceptanceExpiresAt', 'dispatchAttemptCount',
      'financialFinalizedAt', 'deliveredAt', 'deliveryDisputeDeadlineAt',
      'completedAt', 'completionSource', 'deliveryNote',
      'deliveryFailureReason', 'deliveryFailureNote',
      'returnReportedAt', 'returnConfirmedAt', 'returnConfirmedById',
      'returnCondition', 'returnConfirmationNote',
      'cancelledAt', 'cancelledById', 'cancellationReasonCode',
      'cancellationDetails', 'cancelledByRole', 'cancelledAfterPickup',
      'cancellationChargeMinor', 'version', 'updatedAt'
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

UPDATE "DeliveryOrder"
SET
  "dispatchAttemptCount" = 1,
  "acceptanceExpiresAt" = "createdAt" + INTERVAL '5 minutes'
WHERE "status" = 'SEARCHING_COURIER';

UPDATE "DeliveryOrder"
SET "dispatchAttemptCount" = 1
WHERE "dispatchAttemptCount" = 0
  AND "status" NOT IN ('DRAFT', 'QUOTED', 'CANCELLED');

ALTER TABLE "DeliveryOrder"
  DROP CONSTRAINT IF EXISTS "DeliveryOrder_cancelledById_fkey";
ALTER TABLE "DeliveryOrder"
  ADD CONSTRAINT "DeliveryOrder_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeliveryOrder"
  DROP CONSTRAINT IF EXISTS "DeliveryOrder_dispatch_attempt_count_check",
  DROP CONSTRAINT IF EXISTS "DeliveryOrder_cancellation_charge_nonnegative_check";
ALTER TABLE "DeliveryOrder"
  ADD CONSTRAINT "DeliveryOrder_dispatch_attempt_count_check"
  CHECK ("dispatchAttemptCount" BETWEEN 0 AND 2),
  ADD CONSTRAINT "DeliveryOrder_cancellation_charge_nonnegative_check"
  CHECK ("cancellationChargeMinor" >= 0);

CREATE INDEX IF NOT EXISTS "DeliveryOrder_status_acceptanceExpiresAt_idx"
  ON "DeliveryOrder"("status", "acceptanceExpiresAt");
CREATE INDEX IF NOT EXISTS "DeliveryOrder_cancelledById_cancelledAt_idx"
  ON "DeliveryOrder"("cancelledById", "cancelledAt");
