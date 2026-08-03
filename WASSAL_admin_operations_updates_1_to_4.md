# WASSAL Admin Operations Updates — Update 1 to Update 4

Implement the following Admin Web improvements for WASSAL.

The goal is to simplify the Admin workflows, remove duplicated or unnecessary fields, organize all operational data by service zone, and make pricing, courier verification, settlements, and orders easier for Admin employees to manage.

Do not make unrelated changes.

---

# Update 1 — Pricing Rules Management

## Current problems

The pricing-rules page currently has several usability and data-management problems:

1. Old or incorrect pricing rules cannot be removed.
2. The Admin cannot select from existing service zones when creating a pricing rule.
3. Governorate and city are entered again even though they already exist inside the selected service zone.
4. Vehicle type is unnecessary because the MVP currently supports motorcycles only.
5. The pricing form includes fields that are confusing or unnecessary:
   - Maximum distance.
   - Minimum charge.
   - Size surcharges.
   - Tax.
   - Priority.
6. The current structure does not clearly define:
   - Base fee.
   - Distance included in the base fee.
   - Price per extra kilometer.
7. Return-trip pricing should be calculated automatically.
8. Multiple old pricing rules create clutter and confusion.

---

## Required pricing-rules list

Display pricing rules in a clear Arabic RTL table or responsive card layout.

Each rule should show:

- Pricing rule name.
- Linked service zone.
- Governorate and city derived from the linked service zone.
- Status:
  - فعّالة
  - متوقفة
  - مؤرشفة
- Base fee in EGP.
- Included distance in kilometers.
- Extra price per kilometer.
- Return-trip percentage.
- Commission type.
- Commission value.
- Last updated date.
- Available actions.

Provide the following actions:

- "عرض"
- "تعديل"
- "إيقاف" when active.
- "تفعيل" when inactive.
- "حذف" when safe.
- "أرشفة" when deletion is not safe because the pricing rule has historical references.

---

## Delete and archive behavior

Add a visible delete button for pricing rules.

However, preserve historical pricing integrity.

### Hard delete

Allow permanent deletion only when the pricing rule:

- Has never been used by any order.
- Has no settlement, invoice, pricing snapshot, or audit reference.
- Is not currently active.

Show a confirmation dialog:

Title:
"حذف قاعدة التسعير"

Message:
"هل تريد حذف قاعدة التسعير نهائيًا؟ لا يمكن التراجع عن هذا الإجراء."

Actions:

- "إلغاء"
- "تأكيد الحذف"

### Archive instead of delete

If the rule has been used historically:

- Do not hard-delete it.
- Archive it.
- Hide archived rules from the default active list.
- Keep historical order calculations unchanged.
- Allow filtering to show archived rules.

Use the status:

"مؤرشفة"

Display a clear Arabic explanation:

"لا يمكن حذف قاعدة مستخدمة في طلبات سابقة، لذلك تم أرشفتها للحفاظ على السجلات المالية."

---

## Service-zone selection

When creating or editing a pricing rule, the Admin must select from existing service zones.

Use a required dropdown:

"منطقة الخدمة — إجباري"

The dropdown must list active and inactive service zones with clear labels, for example:

- دمياط — فعّالة
- دمياط الجديدة — فعّالة
- بورسعيد — متوقفة

When a service zone is selected, automatically load and display:

- Governorate.
- City.
- Zone status.
- Zone radius.
- Maximum route distance, if it is stored on the zone.

Do not ask the Admin to manually enter governorate or city again.

Governorate and city must be read-only derived information.

Prevent saving a new active pricing rule for an inactive service zone unless the Admin explicitly confirms the intended future configuration.

---

## One active pricing rule per zone

For the MVP, each service zone should have only one active pricing rule at a time.

When activating a new pricing rule for a zone that already has an active rule:

- Show a confirmation dialog.
- Automatically deactivate the previous active rule.
- Preserve the previous rule for historical orders.
- Do not create ambiguity between overlapping active rules.

Because each zone has one active pricing rule, remove the "priority" field from the UI and pricing logic unless there is a proven existing requirement for overlapping rules.

If the backend currently stores priority:

- Keep it internally only when required for compatibility.
- Do not expose it in the Admin form.
- Use a fixed default value.

---

## Vehicle type

Remove the vehicle-type field from the pricing-rule form.

The current MVP supports motorcycle couriers only.

Use a fixed internal value such as:

```ts
vehicleType: "motorcycle"
```

Do not ask the Admin to choose a vehicle type.

Do not remove the database field if it is required for future compatibility; simply set it automatically.

---

## Required pricing fields

The pricing rule must use the following core fields:

### 1. Base fee

Arabic label:

"السعر الأساسي — إجباري"

This is the minimum trip price before extra-distance charges.

Example:

```text
25 EGP
```

### 2. Included distance

Arabic label:

"المسافة المشمولة في السعر الأساسي — إجباري"

Example:

```text
2 km
```

This means the base fee includes the first 2 kilometers.

### 3. Extra price per kilometer

Arabic label:

"سعر الكيلومتر الإضافي — إجباري"

Example:

```text
5 EGP/km
```

This applies only after the included distance.

### Pricing formula

Use the following formula:

```text
If routeDistanceKm <= includedDistanceKm:
    tripPrice = baseFee

If routeDistanceKm > includedDistanceKm:
    tripPrice =
        baseFee
        + (routeDistanceKm - includedDistanceKm) * extraPricePerKm
```

Example:

```text
Base fee: 25 EGP
Included distance: 2 km
Extra price: 5 EGP/km
Actual route: 6 km

Trip price:
25 + (6 - 2) × 5 = 45 EGP
```

Round money according to the existing project convention.

---

## Remove unnecessary pricing fields

Remove the following from the visible pricing form:

- Maximum distance.
- Minimum charge.
- Size surcharges.
- Priority.
- Tax.
- Governorate.
- City.
- Vehicle type.

### Maximum distance

Maximum route distance belongs to the service-zone or order-validation settings, not the pricing formula.

Do not duplicate it inside the pricing rule.

### Minimum charge

The base fee already acts as the minimum charge.

Remove the separate minimum-charge field to avoid duplication.

### Size surcharges

Remove size-based surcharges from the MVP.

Do not display or calculate:

- Small size surcharge.
- Medium size surcharge.
- Large size surcharge.
- Any package-dimension surcharge.

### Tax

Remove the tax field from the Admin pricing-rule UI for the MVP.

Do not add tax automatically to the customer or merchant price.

If tax support already exists in the database:

- Keep the field nullable or defaulted to zero.
- Do not expose it in the UI.
- Do not include tax in price calculation unless a future business/legal requirement is explicitly implemented.

Do not confuse platform commission with tax.

---

## Keep weight tiers

Keep weight-based pricing tiers.

The Admin should be able to configure optional weight tiers such as:

- Up to 5 kg.
- More than 5 kg up to 10 kg.
- More than 10 kg.

Use the existing business logic where appropriate.

Each weight tier should support:

- Minimum weight.
- Maximum weight.
- Additional fixed fee or additional percentage, according to the existing model.

Clearly label all weight fields in Arabic.

Do not require weight tiers if the Admin does not need them.

---

## Keep fragile and thermal-bag options

Keep the following optional surcharges:

### Fragile item

Arabic label:

"قابل للكسر"

Allow a configurable fixed surcharge.

### Thermal bag

Arabic label:

"حقيبة حرارية"

Allow a configurable fixed surcharge.

Both options must remain optional and default to zero when not configured.

---

## Return-trip pricing

Remove manual return-trip pricing entry.

Calculate return pricing automatically as:

```text
Return trip price = 70% of the original calculated delivery trip price
```

The original calculated delivery trip price means:

- Base fee.
- Extra-distance charge.
- Applicable weight surcharge.
- Fragile surcharge.
- Thermal-bag surcharge.

Do not calculate the return percentage from platform commission.

Do not include the platform commission inside the return-trip base.

Store the return percentage as:

```text
70%
```

Display it as read-only in the form:

"سعر المرتجع: 70% من سعر رحلة التوصيل"

If the business may need to change this later, support it as a system-level setting, but default it to 70%.

---

## Commission configuration

Keep commission configuration.

Support both commission types:

- Percentage.
- Fixed amount.

Arabic labels:

- "نوع العمولة"
- "نسبة مئوية"
- "مبلغ ثابت"
- "قيمة العمولة"

Examples:

```text
20%
```

or:

```text
10 EGP
```

Commission is the platform amount due from the merchant or courier according to the existing settlement model.

Do not label commission as tax.

Validate:

- Percentage must be between 0 and 100.
- Fixed amount must be zero or greater.

---

## Final pricing form layout

Use this order:

### البيانات الأساسية

- Pricing rule name — required.
- Service zone — required.
- Read-only governorate.
- Read-only city.
- Status.

### حساب سعر الرحلة

- Base fee — required.
- Included distance — required.
- Extra price per kilometer — required.

### إضافات الوزن

- Existing weight tiers — optional.

### إضافات الطلب

- Fragile-item surcharge — optional.
- Thermal-bag surcharge — optional.

### المرتجع

- Return trip percentage — read-only, 70%.

### عمولة المنصة

- Commission type — required.
- Commission value — required.

Do not show:

- Tax.
- Priority.
- Vehicle type.
- Size additions.
- Separate minimum charge.
- Maximum distance.
- Manual governorate.
- Manual city.

---

## Pricing verification

Test:

1. Create a pricing rule for Damietta with:
   - Base fee 25 EGP.
   - Included distance 2 km.
   - Extra kilometer 5 EGP.
2. Verify a 2 km route costs 25 EGP.
3. Verify a 6 km route costs 45 EGP.
4. Verify the zone dropdown lists the existing service zones.
5. Verify governorate and city are derived automatically.
6. Verify vehicle type is not shown and is stored as motorcycle internally.
7. Verify tax, priority, maximum distance, minimum charge, and size additions are removed.
8. Verify weight tiers remain available.
9. Verify fragile and thermal-bag surcharges remain available.
10. Verify return pricing is 70% of the original trip price.
11. Verify commission supports percentage and fixed amount.
12. Verify only one active pricing rule can exist per zone.
13. Verify an unused inactive rule can be deleted.
14. Verify a historically used rule is archived instead of deleted.
15. Run relevant tests, type checks, lint, and builds.

---

# Update 2 — Courier Verification Dashboard

## Goal

Create a clear courier-verification dashboard in Admin Web.

The dashboard must organize couriers by verification status and allow Admin employees to quickly access each group.

---

## Dashboard summary cards

Display four summary cards:

1. "تحت المراجعة"
2. "معتمدون"
3. "مطلوب تعديل"
4. "موقوفون"

Each card must show:

- Number of couriers in the status.
- Clear icon.
- Status label.
- Optional short description.

Example:

```text
تحت المراجعة
12 مندوب
```

Clicking a card must filter the courier list to that status.

---

## Courier statuses

Use clear canonical statuses:

```text
pending_review
approved
changes_requested
suspended
```

Arabic labels:

```text
pending_review      → تحت المراجعة
approved            → معتمد
changes_requested   → مطلوب تعديل
suspended           → موقوف
```

Preserve existing backend status names when necessary, but map them consistently in the UI.

---

## Courier list

After clicking a dashboard card, display the matching couriers.

Each row or card should show:

- Courier full name.
- Phone number.
- City.
- Linked service zone, if available.
- Submission date.
- Current verification status.
- Missing or rejected documents, when relevant.
- Last review date.
- Reviewer name, when available.
- Actions.

Actions may include:

- "عرض التفاصيل"
- "اعتماد"
- "طلب تعديل"
- "إيقاف"
- "إعادة التفعيل"

---

## Courier details

The courier-details page or drawer should display:

- Personal information.
- Phone.
- National ID information according to the existing privacy rules.
- Driver license.
- Vehicle license.
- Motorcycle details.
- Uploaded verification documents.
- Document expiry dates.
- Linked service zone or operating city.
- Verification timeline.
- Admin notes.
- Current status.

Do not expose sensitive document details to unauthorized Admin roles.

---

## Verification actions

### Approve

Allow Admin to approve a courier after checking required documents.

Arabic confirmation:

"هل تريد اعتماد هذا المندوب؟"

### Request changes

Allow Admin to select or write required corrections.

Examples:

- صورة البطاقة غير واضحة.
- رخصة القيادة منتهية.
- رخصة المركبة غير مكتملة.
- البيانات الشخصية غير متطابقة.

Use status:

```text
changes_requested
```

The courier should be able to understand what must be corrected.

### Suspend

Allow Admin to suspend an approved courier.

Require a reason.

Do not delete the courier account.

### Reactivate

Allow Admin to reactivate a suspended courier when appropriate.

---

## Courier dashboard filters

Support filters for:

- Status.
- Service zone.
- City.
- Submission date.
- Document expiry.
- Search by name or phone.

The default page should show the summary cards and the pending-review list.

---

## Courier verification metrics

Show at minimum:

- Pending-review count.
- Approved count.
- Changes-requested count.
- Suspended count.

Optionally show:

- Reviewed today.
- Average verification waiting time.
- Documents expiring soon.

Do not add complex analytics unless supported by existing data.

---

## Courier-verification verification

Test:

1. Verify all four summary cards display correct counts.
2. Click "تحت المراجعة" and verify only pending couriers appear.
3. Click "معتمدون" and verify only approved couriers appear.
4. Click "مطلوب تعديل" and verify only couriers needing changes appear.
5. Click "موقوفون" and verify only suspended couriers appear.
6. Approve a pending courier.
7. Request changes with a reason.
8. Suspend an approved courier with a reason.
9. Reactivate a suspended courier.
10. Verify counts refresh immediately after each action.
11. Verify role-based access.
12. Run relevant tests and builds.

---

# Update 3 — Finance and Settlements by Service Zone

## Goal

Reorganize the Finance and Settlements section by service zone.

The Admin should first see the active operating zones, then open a zone to view its financial dashboard and courier settlements.

Examples:

- دمياط
- دمياط الجديدة
- بورسعيد

Do not mix all zones together in one unorganized page by default.

---

## Finance zones dashboard

The main Finance and Settlements page must display one card or row per service zone.

Each zone should show summary values such as:

- Number of couriers.
- Open settlements count.
- Overdue settlements count.
- Total amount currently due to the company.
- Amount collected today.
- Amount collected in the current month.
- Last settlement activity.

Example:

```text
دمياط الجديدة

المندوبون: 24
التسويات المفتوحة: 8
التسويات المتأخرة: 3
المتبقي للشركة: 12,500 EGP
المحصل اليوم: 1,800 EGP
المحصل هذا الشهر: 36,200 EGP
```

Clicking a zone opens the zone financial dashboard.

---

## Zone financial dashboard

For the selected zone, show:

### Summary cards

- Total active couriers.
- Open settlements.
- Overdue settlements.
- Total outstanding amount due to the company.
- Amount collected today.
- Amount collected this month.

### Courier settlement list

Show courier-level financial information:

- Courier name.
- Phone.
- Number of completed orders.
- Number of returned orders.
- Gross order value, when relevant.
- Platform commission due.
- Amount already paid.
- Remaining balance.
- Settlement due date.
- Settlement status.
- Last payment date.

Statuses:

- مفتوحة.
- مدفوعة جزئيًا.
- مكتملة.
- متأخرة.
- متنازع عليها, when supported.

---

## Zone and city filtering

All financial calculations must be scoped by service zone.

The Admin may additionally filter by:

- City.
- Date range.
- Courier.
- Settlement status.

Do not mix values from different zones in the selected-zone totals.

---

## Collected today and this month

Calculate:

### Collected today

Total confirmed settlement payments received during the current local calendar day.

### Collected this month

Total confirmed settlement payments received from the first day of the current local month through today.

Do not count:

- Pending payments.
- Failed payments.
- Cancelled payment records.
- Unconfirmed manual entries.

Use the project timezone consistently.

---

## Outstanding amount due to the company

Display:

"إجمالي المتبقي للشركة"

This should represent the confirmed amount still owed to the platform/company after:

- Platform commissions.
- Confirmed payments.
- Approved adjustments.
- Confirmed settlement records.

Document the exact formula used based on the existing settlement model.

Do not invent a parallel financial model if the project already has one.

---

## Finance permissions and audit

Only authorized Admin finance roles may:

- Mark payments received.
- Adjust settlement balances.
- Close settlements.
- Reopen settlements.
- Add financial notes.

Record:

- Admin user.
- Action.
- Old value.
- New value.
- Date and time.
- Reason where applicable.

---

## Finance verification

Test:

1. Open Finance and Settlements and verify service-zone cards appear.
2. Verify each zone displays correct courier and settlement counts.
3. Open Damietta and verify only Damietta financial data appears.
4. Open New Damietta and verify only New Damietta data appears.
5. Verify open-settlement count.
6. Verify overdue-settlement count.
7. Verify total outstanding amount due to the company.
8. Verify collected-today value.
9. Verify collected-this-month value.
10. Record a settlement payment and verify totals refresh.
11. Verify role-based financial permissions.
12. Run relevant tests and builds.

---

# Update 4 — Orders Dashboard by Service Zone

## Goal

Reorganize the Admin Orders section by service zone.

The current page displays orders from all areas together, which makes it difficult for Admin employees to manage operations.

The Admin should first see service-zone cards, then open a zone to view only its orders.

Examples:

- دمياط
- دمياط الجديدة
- بورسعيد

---

## Orders zones dashboard

The main Orders page should display one card or row per service zone.

Each zone card should show useful summary values:

- Total orders today.
- New or available orders.
- Accepted orders.
- In-progress orders.
- Completed orders.
- Returned orders.
- Cancelled orders.
- Disputed orders, when supported.
- Unassigned orders.
- Last activity time.

Keep the card readable and do not overload it.

At minimum show:

- Orders today.
- Active orders.
- Completed today.
- Returned today.

Clicking the zone card opens the orders list filtered to that zone.

---

## Zone orders page

The selected zone must be clearly shown in the page title.

Example:

"طلبات منطقة دمياط الجديدة"

Display only orders associated with:

- A pickup branch inside the selected service zone.
- Or the canonical zone ID stored on the order.

Prefer using the stored service-zone ID on the order when available.

Do not determine the zone only from free-text city names.

---

## Orders summary inside a zone

Show summary cards for:

- New.
- Available to couriers.
- Accepted.
- Picking up.
- In delivery.
- Completed.
- Returned.
- Cancelled.
- Disputed.

Use the current project statuses and map them to clear Arabic labels.

Clicking a summary card filters the order list.

---

## Orders list

Each order row or card should show:

- Order number.
- Merchant name.
- Pickup branch.
- Recipient name.
- Recipient phone.
- Pickup address.
- Delivery address.
- Assigned courier, if any.
- Order status.
- Price.
- Distance.
- Created time.
- Last status update.
- Service zone.

Actions should follow existing permissions and may include:

- View details.
- Assign or reassign courier when supported.
- Cancel.
- Mark or review dispute.
- Review return.
- View status timeline.

---

## Orders filters

Support filters for:

- Service zone.
- Status.
- Merchant.
- Branch.
- Courier.
- Date range.
- Order number.
- Recipient phone.

When inside a selected zone, keep the zone filter locked or clearly scoped unless the Admin returns to the all-zones dashboard.

---

## All-zones view

An optional "كل المناطق" view may remain available for senior Admin users.

However:

- The default operational workflow must start from the zones dashboard.
- The all-zones view must not be the only view.
- Clearly show the zone for every order in the combined view.

---

## Orders verification

Test:

1. Open the Admin Orders page and verify zone cards appear.
2. Open Damietta and verify only Damietta orders appear.
3. Open New Damietta and verify only New Damietta orders appear.
4. Open Port Said and verify only Port Said orders appear.
5. Verify zone order counts.
6. Verify status summary counts.
7. Click a status card and verify the list filters correctly.
8. Verify order details show the service zone.
9. Verify search and filters remain scoped to the selected zone.
10. Verify authorized senior Admin users can access an all-zones view.
11. Run relevant tests and builds.

---

# Shared UX Requirements

Apply the following to all four updates:

- Arabic RTL.
- Responsive desktop and tablet layouts.
- Use the existing WASSAL Admin design system.
- Use clear Arabic empty states.
- Use loading skeletons or clear loading indicators.
- Display structured Arabic errors.
- Do not display raw JSON.
- Refresh counts and lists after successful changes.
- Disable action buttons while requests are processing.
- Preserve role-based access control.
- Preserve existing historical orders, settlements, and audit records.
- Do not create duplicate records when editing existing records.
- Use pagination for long lists.
- Use accessible confirmation dialogs.
- Keep URL filters or query parameters when practical so pages can be refreshed without losing the selected zone or status.

---

# API and Data Requirements

Before implementing, inspect the existing:

- Prisma schema.
- Pricing-rule model.
- Service-zone model.
- Courier verification model.
- Order model.
- Settlement model.
- Admin API routes.
- DTOs and validation schemas.
- Existing audit-log implementation.

Prefer adapting the current data model instead of creating conflicting duplicate structures.

Add database migrations only when genuinely required.

Where zone-based filtering is needed, use stable service-zone IDs rather than governorate or city strings.

If an order or settlement does not currently store a service-zone ID:

- Determine the safest migration or association strategy.
- Backfill records where reliable.
- Do not guess zone assignments from ambiguous text.
- Report any records that cannot be assigned safely.

---

# Final Report

After implementing all updates, report:

## Update 1

- Pricing fields removed.
- Pricing fields retained.
- Final pricing formula.
- Return-trip calculation.
- Delete versus archive behavior.
- How one active pricing rule per zone is enforced.
- Files changed.
- API and database changes.

## Update 2

- Courier statuses used.
- Dashboard counts added.
- Verification actions added.
- Files changed.
- API and database changes.

## Update 3

- Zone financial metrics added.
- Outstanding-balance formula.
- Collected-today and collected-this-month formulas.
- Files changed.
- API and database changes.

## Update 4

- Zone order dashboard behavior.
- Order-to-zone association method.
- Status filters added.
- Files changed.
- API and database changes.

Also report:

- Tests added or updated.
- Type-check result.
- Lint result.
- Unit and integration test results.
- Production build results.
- Any known limitations.
