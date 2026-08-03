ALTER TABLE "ServiceZone"
  ADD COLUMN "centerLatitude" DECIMAL(9,6),
  ADD COLUMN "centerLongitude" DECIMAL(9,6),
  ADD COLUMN "radiusKm" DECIMAL(8,3);

UPDATE "ServiceZone"
SET
  "centerLatitude" = ST_Y(ST_Centroid("boundary"::geometry)),
  "centerLongitude" = ST_X(ST_Centroid("boundary"::geometry)),
  "radiusKm" = "maximumRouteDistanceMeters"::numeric / 1000;

ALTER TABLE "ServiceZone"
  ALTER COLUMN "centerLatitude" SET NOT NULL,
  ALTER COLUMN "centerLongitude" SET NOT NULL,
  ALTER COLUMN "radiusKm" SET NOT NULL;

UPDATE "ServiceZone"
SET "boundary" = ST_Multi(
  ST_Buffer(
    ST_SetSRID(
      ST_MakePoint("centerLongitude"::double precision, "centerLatitude"::double precision),
      4326
    )::geography,
    "radiusKm"::double precision * 1000
  )::geometry
)::geography;

ALTER TABLE "ServiceZone"
  ADD CONSTRAINT "ServiceZone_center_latitude_check"
    CHECK ("centerLatitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "ServiceZone_center_longitude_check"
    CHECK ("centerLongitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "ServiceZone_radius_positive_check"
    CHECK ("radiusKm" > 0);

CREATE UNIQUE INDEX "ServiceZone_active_name_center_radius_key"
  ON "ServiceZone" (
    lower("name"),
    "centerLatitude",
    "centerLongitude",
    "radiusKm"
  )
  WHERE "status" = 'ACTIVE';
