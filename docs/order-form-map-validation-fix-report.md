# WASSAL Merchant Order Form and Map Validation Fix

Date: 2026-07-29

## Scope

Implemented only the Merchant Web order-creation and shared API validation
behavior requested by `WASSAL_order_form_map_validation_fix_prompt.md`.

- No Admin Web workflow was changed.
- No database model or migration was added.
- No paid maps, geocoding, places, or routing provider was added.
- The existing deterministic local routing/pricing authority remains on the
  backend.

## Root causes

### Partially rendered map

The in-project map is a custom OpenStreetMap tile canvas, not Leaflet. Its tile
matrix is calculated from the measured DOM viewport.

The previous implementation started with a fixed `640 x 360` fallback, took one
immediate measurement, and then depended only on `ResizeObserver`. When the
dialog had just been attached or its parent layout had not settled, the tiles
could be calculated for the fallback/previous width. The location panel also
used `overflow: hidden`, so layout changes could clip the result.

The fix:

- gives the map `width: 100%`, `min-width: 0`, an explicit responsive height,
  and an explicit minimum height;
- removes clipping from the parent location panel;
- isolates the interactive map paint layer and keeps tile overflow inside the
  map viewport;
- measures immediately, after two animation frames, after 240 ms, on every
  `ResizeObserver` notification, and on browser resize;
- recenters the initial marker after the dialog layout settles without
  overriding a merchant interaction;
- keeps preview sizing separate from the interactive mobile-map sizing;
- confirms the Merchant CSS is imported once by the root layout.

Address search opens a free Google Maps web search. The merchant can then copy
the chosen place link into the existing link-resolution/review flow. WASSAL
does not silently call an unapproved public geocoder.

### Generic `The request data is invalid.`

There were two concrete causes:

1. The old form collected independent customer and recipient values. It only
   checked HTML presence for values whose API contract also requires phone
   format and minimum text lengths. A one-character address/description or an
   invalid phone could therefore reach Zod and fail.
2. `parseInput()` created a structured Nest exception, but the global HTTP
   filter read `HttpException.message` instead of `HttpException.getResponse()`.
   It dropped the validation code, issues, and field information. Merchant Web
   then had only the generic message to display.

The API filter now preserves the structured error body, and the order controller
maps quote-validation paths to canonical Arabic fields. Merchant Web validates
the same constraints before the request, displays a summary plus inline Arabic
errors, and focuses/scrolls to the first invalid field.

Service failures now have stable codes and exact Arabic messages:

- `order_invalid_store`
- `order_outside_service_zone`
- `order_route_distance_exceeded`
- `order_route_calculation_failed`

## Payload before

The active form previously assembled two independent contact sources:

```ts
{
  storeId,
  customer:
    selectedCustomer
      ? { customerId }
      : { name: customerName, phone: customerPhone, email?: customerEmail },
  dropoff:
    savedAddress
      ? { addressId }
      : {
          contactName: contactName || customerName,
          contactPhone: contactPhone || customerPhone,
          addressLine,
          street?: string,
          buildingNumber?: string,
          floor?: string,
          apartment?: string,
          landmark?: string,
          area,
          city,
          governorate,
          latitude,
          longitude
        },
  package: { ... }
}
```

This allowed the customer and recipient to disagree and allowed email into the
quote request.

## Payload after

One canonical recipient is entered once and used for both pieces required by
the existing backend contract:

```ts
{
  storeId: string,
  customer: {
    name: recipientName.trim(),
    phone: normalizedEgyptianPhone
  },
  dropoff: {
    saveAddress: boolean,
    contactName: recipientName.trim(),
    contactPhone: normalizedEgyptianPhone,
    addressLine: addressLine.trim(),
    street?: string,
    buildingNumber?: string,
    floor?: string,
    apartment?: string,
    landmark?: string,
    area: validatedServiceZone.name,
    city: validatedServiceZone.city,
    governorate: validatedServiceZone.governorate,
    deliveryNotes?: string,
    sourceMapsUrl?: string,
    locationSource: "MAP_PICKER" | "DEVICE_LOCATION" | "GOOGLE_MAPS_LINK",
    latitude: number,
    longitude: number
  },
  package: {
    category: string,
    itemDescription: string,
    size: string,
    weightGrams: number,
    packageCount: number,
    fragile: boolean,
    requiresThermalBag: boolean,
    courierNotes?: string,
    declaredValueMinor: number,
    prohibitedItemsConfirmed: true
  }
}
```

Empty optional strings are omitted. Empty numeric strings are rejected before
building the request. Latitude, longitude, weight, count, and declared value are
numbers. No order-creation payload includes email.

When an existing merchant customer is found by phone, the backend synchronizes
its name with the canonical recipient name so the quote/order snapshot does not
silently retain a different old name.

## Form fields

Removed from order creation:

- duplicate customer name;
- duplicate customer phone;
- email;
- manual latitude and longitude inputs;
- duplicated recipient/contact fallback state.

Required and explicitly labelled `إجباري`:

- pickup branch;
- recipient name;
- recipient phone;
- full textual address;
- delivery point selected on the map;
- item category and description;
- size, weight, package count, and declared value;
- prohibited-items confirmation.

Optional and explicitly labelled `اختياري`:

- Google Maps link;
- street;
- building number;
- floor;
- apartment number;
- landmark;
- courier notes;
- save-address control;
- fragile and thermal-bag controls.

The selected branch address, branch map preview, coverage status, selected
delivery coordinates, source, and service-zone result are displayed for review.

## API changes

- `parseInput()` can attach canonical localized field errors while retaining
  the existing validation convention.
- `HttpExceptionFilter` preserves code, message, fields, and validation details
  from Nest HTTP exceptions.
- Quote validation maps backend paths to Merchant form fields.
- Store, coverage, route-distance, and route-calculation failures return stable
  codes and exact messages.
- Existing-customer name synchronization supports the single-recipient
  representation.

The quote and create-order schemas themselves were not replaced, and no
parallel DTO was introduced.

## Verification

Automated:

- Focused Merchant/API/validation tests: 9 files, 42 tests passed.
- Phase 2 database/API integration: 1 file, 6 tests passed.
- Merchant TypeScript: passed.
- API TypeScript: passed.
- Full repository lint: passed.
- Targeted final lint: passed.
- Merchant production build: passed.
- API production build: passed.
- Prettier check for all changed files: passed.

The first integration run correctly exposed that the local demo database had
all Damietta pricing rules set to `INACTIVE`. The repository's deterministic
seed was run, then the integration suite passed.

Runtime against the updated API on port 3100:

- `GET /api/v1/health`: HTTP 200.
- Structured invalid quote: HTTP 400 with `validation_failed`, Arabic summary,
  and canonical field keys.
- Over-distance quote: HTTP 400 with
  `order_route_distance_exceeded` and
  `المسافة الفعلية للطلب تتجاوز الحد الأقصى المسموح.`
- Valid quote: `75c308e8-5119-4dcc-8993-9c231451d4aa`, 2494 meters,
  2247 minor EGP.
- Valid order: `WSL-260729-37E963460C`, status `SEARCHING_COURIER`.
- Merchant Web root on port 3002: HTTP 200.

The Codex in-app browser could not attach a webview, so a live visual assertion
for “no pink/blank tiles” was not claimed. Responsive sizing, delayed
remeasurement, reopen behavior, labels, payload, and validation have regression
coverage, but the final visual desktop/tablet/mobile pass should still be
performed in an attached browser.

## Files changed

Merchant Web:

- `apps/merchant-web/app/merchant-app.tsx`
- `apps/merchant-web/app/new-order.tsx`
- `apps/merchant-web/app/new-order.test.tsx`
- `apps/merchant-web/app/order-form.ts`
- `apps/merchant-web/app/order-form.test.ts`
- `apps/merchant-web/app/map-picker.tsx`
- `apps/merchant-web/app/map-picker.test.tsx`
- `apps/merchant-web/app/open-map.ts`
- `apps/merchant-web/app/open-map.test.ts`
- `apps/merchant-web/app/styles.css`

API:

- `apps/api/src/infrastructure/request.ts`
- `apps/api/src/infrastructure/request.test.ts`
- `apps/api/src/infrastructure/http-exception.filter.ts`
- `apps/api/src/infrastructure/http-exception.filter.test.ts`
- `apps/api/src/orders/orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/phase-two.e2e.test.ts`

Documentation:

- `docs/order-form-map-validation-fix-report.md`
