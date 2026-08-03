ALTER TABLE "PricingRule"
ADD COLUMN "returnTripPercentageBasisPoints" INTEGER NOT NULL DEFAULT 7000;

ALTER TABLE "PricingRule"
ADD CONSTRAINT "PricingRule_returnTripPercentageBasisPoints_check"
CHECK ("returnTripPercentageBasisPoints" BETWEEN 0 AND 10000);

CREATE UNIQUE INDEX "PricingRule_one_active_rule_per_zone"
ON "PricingRule" ("serviceZoneId")
WHERE "status" = 'ACTIVE' AND "serviceZoneId" IS NOT NULL;
