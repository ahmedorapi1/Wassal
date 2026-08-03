# Service zones and pricing

## Service zones

An operational zone has country, governorate, city, name, active status,
pickup/drop-off permissions, a center, service radius, maximum route distance,
priority, and version. Center and radius are stored independently as
`centerLatitude`, `centerLongitude`, and `radiusKm`.

Coverage uses PostGIS `ST_DWithin` over geography values. The existing
`MultiPolygon` boundary remains as a compatibility and visualization field and
is generated automatically with a geodesic `ST_Buffer`; admins never enter raw
north/south/east/west coordinates.

Quote creation resolves an active, pickup/drop-off-enabled zone whose circle
covers both points and for which an active pricing rule can be resolved. This
keeps legitimate overlapping zones safe when one overlap has not yet received
pricing. An out-of-zone request receives a safe validation error without
exposing geometry internals.

The service radius is not a route limit. After geographic coverage resolves,
the maps provider calculates the route and the backend separately enforces
`maximumRouteDistanceMeters` and the pricing rule's maximum distance.

Reducing a radius affects future validation immediately. Existing branches and
historical orders remain stored; merchant store reads annotate branches that
are outside every currently active pickup zone.

## Pricing resolution

Rules are immutable versions grouped by `ruleFamilyKey`. Resolution filters by
country/governorate/city, motorcycle, active effective dates, and either the
resolved service zone or a city fallback. The winner is deterministic:

1. zone-specific beats city fallback;
2. higher priority wins;
3. newer effective start wins;
4. stable identifier order breaks a final tie.

Activation rejects ambiguous same-scope, same-priority effective-date overlap.
Historical versions are never overwritten; edits create a draft version.

All calculations use EGP integer minor units. Components are base, billable
distance, size, weight band, fragile, thermal bag, discount (zero), surge
(zero), tax placeholder, merchant total, commission, and estimated courier
earning. Percentage calculations use deterministic half-up integer rounding.
The quote and order store every component and the selected rule version.
