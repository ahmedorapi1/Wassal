# Customer and address design

Customers are tenant-owned by `merchantId`. Their normalized Egyptian mobile
number is unique only inside that merchant, preventing cross-merchant account
disclosure. Records support `ACTIVE` and `ARCHIVED`; archive is logical so
historical orders retain references.

Saved addresses belong to both the merchant and customer and include label,
recipient contact, structured location details, instructions, latitude,
longitude, a PostGIS geography point, source, validation status, archive time,
and optimistic version.

The API validates Egypt-supported coordinates and normalizes recipient phones.
It writes numeric coordinates and the PostGIS point together. Database checks
enforce geographic ranges and require the point to match the stored numbers.

Pickup addresses are generated from an active merchant store. Drop-off can use
an active saved address or a one-use address. Quote and order snapshots contain
all address fields, so saved-address edits never rewrite history.

The maps port supports future geocoding and routing adapters. Phase 2 does not
send customer data to a paid provider.
