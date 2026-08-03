# Codex Audit Prompt — MVP Location, Orders, Pricing, and Courier Accounting

I want you to inspect the entire motorcycle delivery application repository, but **do not modify any existing file and do not implement any new production code at this stage**.

The purpose of this task is to create a precise technical audit of the current MVP implementation, especially everything related to:

1. Location and distance handling.
2. Courier tracking.
3. Available order marketplace and order acceptance.
4. Pricing.
5. Platform commission and courier liabilities.
6. Courier order statistics.
7. Admin dashboard capabilities.
8. Settlement periods and payment deadlines.

---

## 1. Inspect the Current Location Implementation

Explain in detail:

- Does the application currently use GPS?
- Are location permissions requested in the courier or merchant applications?
- Is live or real-time courier tracking implemented?
- Is the courier's location sent to the backend?
- Are courier coordinates stored continuously?
- Are there any database models or tables for courier locations or movement history?
- Is WebSocket, Socket.IO, SSE, or any other real-time tracking mechanism used?
- Is there a worker, cron job, or background job that processes courier locations?
- Are maps embedded in any application?
- Which map provider is used, if any?
- Is the project using Google Maps, Mapbox, OpenStreetMap, HERE, or another maps API?
- Is distance calculated using a routing API or a direct coordinate-based calculation?
- Are there any current services that may generate costs based on map requests, location requests, routes, or number of orders?

For every finding, include:

- File path.
- Model or table name.
- Service or provider name.
- API endpoint.
- Feature flag.
- Environment variable.
- Test file, if available.

### MVP Product Decision for Location

For the initial MVP, we do **not** want:

- Live courier tracking.
- Continuous location sharing.
- Background GPS updates.
- Courier route or movement-history storage.
- Tracking-specific WebSockets.
- Live ETA calculations.
- Courier monitoring on an internal map.
- Any unnecessary paid maps or routing service.

The required MVP courier experience is:

1. The courier opens an available-orders screen.
2. The courier sees available delivery requests.
3. Each request displays the essential pickup and delivery information.
4. The courier chooses and accepts the preferred order.
5. The courier goes to the pickup point and then to the delivery address.
6. The app may open the pickup or delivery address in an external navigation application such as Google Maps.
7. The system does not need to know or track the courier's live location.

Compare the current implementation with this product decision.

Classify every related component as one of the following:

- Keep for MVP.
- Disable using a feature flag.
- Remove from MVP scope.
- Keep for future implementation.
- Redesign before use.

Do not delete or modify anything during this audit.

---

## 2. Inspect the Current Order Marketplace and Assignment Flow

Explain:

- How is an order currently created?
- Does the merchant select a specific courier?
- Does the system automatically assign a courier?
- Can all couriers see an order?
- Is an order shown only to couriers in a specific city, zone, or delivery area?
- Is there any radius or distance filter?
- Is there a bidding or offer mechanism?
- What order statuses currently exist?
- What happens when a courier accepts an order?
- How does the system prevent two couriers from accepting the same order?
- Is acceptance protected using an atomic database update, transaction, row lock, optimistic lock, unique constraint, or another concurrency mechanism?
- What happens if a courier cancels after accepting?
- What happens if the merchant or customer returns the order?
- Is there a clearly implemented return-order concept?
- Is every order-status transition recorded in an audit or status-history table?

### Required MVP Order Flow

The required MVP behavior is:

1. The merchant creates an order.
2. The order becomes available to eligible couriers.
3. Couriers choose orders themselves.
4. The first courier who successfully accepts the order becomes responsible for it.
5. The merchant does not select a specific courier in the default workflow.
6. Manual assignment by an administrator may be added later, but it is not the primary MVP workflow.
7. The system must prevent the same order from being accepted by multiple couriers.
8. Every order-status transition should be recorded.

Compare this required flow with the current implementation.

---

## 3. Inspect the Current Pricing Logic

Explain:

- How is the delivery price determined?
- Does the merchant enter the price manually?
- Is the price calculated from distance?
- Is there a price-per-kilometer formula?
- Is there a base fare or minimum fare?
- Is pricing based on city, zone, or delivery area?
- Is there separate pricing for return deliveries?
- Is surge pricing or peak-hour pricing implemented?
- Is a routing or distance API used?
- Is the final price stored when the order is created?
- Can the price be recalculated later?
- Can the admin change pricing rules?
- Does changing a pricing setting affect old orders?
- Is the price stored as an immutable snapshot on the order?

Provide at least one numerical example from seeds, fixtures, or tests if available.

Do not assume any pricing logic that is not proven by the code.

---

## 4. Inspect All Current Financial Features

For the MVP, we do **not** want any in-app financial transaction processing.

We do not want:

- A payment gateway.
- Bank-card payments.
- Merchant online payments.
- Automatic courier payouts.
- Wallet top-ups.
- Wallet withdrawals.
- Electronic refunds.
- Internal money transfers.
- Stripe integration.
- Paymob integration.
- Fawry integration.
- Any other payment-provider integration.
- Storage of bank-card data.
- Automatic collection of the platform commission.

The MVP only needs an **internal accounting system** that calculates and records amounts.

Inspect the project and explain:

- Is there currently a wallet?
- Is there a ledger?
- Are there financial transaction records?
- Are there payment integrations?
- Are there Payments, Payouts, Withdrawals, Wallets, Balances, Invoices, or Settlement tables?
- Is platform commission currently calculated?
- Is there a courier balance or merchant balance?
- Are there payment-related API keys or environment variables?
- Are there feature flags related to COD, payments, wallets, or payouts?
- Is there unused financial code that adds unnecessary complexity to the MVP?
- Could any currently configured financial provider generate real costs?

For every finding, include the related:

- File path.
- Database model.
- Enum.
- Endpoint.
- UI screen.
- Background job.
- Environment variable.
- Feature flag.
- Test.

---

## 5. Required MVP Commission Logic

The platform must calculate the administration commission only. It must not collect it electronically inside the application.

The default platform commission is:

**20%**

The administrator must be able to change the default commission percentage from the admin dashboard.

The commission configuration must:

- Be stored in platform settings.
- Be editable by authorized administrators.
- Have a default value of 20%.
- Not affect completed or historical orders retroactively.
- Be snapshotted on each relevant order.
- Store the exact commission rate used for the order.
- Store the exact platform commission amount.
- Store the courier net amount for reporting purposes.
- Use integer minor units or an exact decimal type.
- Never use floating-point calculations for money.

Example:

- Delivery fee: 100.
- Platform commission: 20%.
- Amount due to administration: 20.
- Courier net amount: 80.

The application will not transfer the 80 to the courier and will not automatically collect the 20.

It will only record that the courier owes 20 to the administration.

Inspect whether this logic currently exists and explain what is missing.

Also inspect when the commission is currently created or should be snapshotted:

- When the order is created.
- When the order is accepted.
- When the order is picked up.
- When the order is delivered.
- When the order is marked completed.

State the current implementation and recommend the safest option, but do not implement it.

---

## 6. Inspect Courier Activity and Accounting

Each courier should eventually be able to view a clear account summary containing:

- Number of accepted orders.
- Number of completed orders.
- Number of cancelled orders.
- Number of returned orders.
- Total completed delivery fees.
- Total value of return deliveries.
- Total platform commission due.
- Amount recorded as paid to the administration.
- Remaining amount due.
- Settlement-period start date.
- Settlement-period end date.
- Payment deadline.
- Number of days remaining until the deadline.
- Payment status.

Suggested payment statuses:

- `NOT_DUE`
- `DUE_SOON`
- `OVERDUE`
- `PARTIALLY_PAID`
- `PAID`
- `WAIVED`
- `ADJUSTED`

Inspect whether any current screens, models, APIs, read models, reports, or services provide these values.

Explain:

- What currently defines a financially completed order?
- Is commission calculated at `DELIVERED` or `COMPLETED`?
- How is a cancelled order handled?
- How is a returned order handled?
- Does a returned order create a separate delivery fee?
- Does a return reverse the original commission?
- Are manual adjustments supported?
- Are waivers supported?
- Are partial payments supported?
- Are courier account statements supported?
- Is there any ledger entry for each order?

Do not invent a final return-order policy.

Instead:

1. Document the current behavior.
2. Identify missing decisions.
3. Present the reasonable product options and their consequences.

---

## 7. Inspect Settlement Periods and Payment Deadlines

The MVP should support an accounting cycle or settlement period for each courier.

A possible example:

- Orders are grouped weekly.
- The settlement period has a start and end date.
- When the period closes, the amount due becomes final.
- The courier receives a configurable number of days to pay.
- The administrator may configure a grace period such as 3 or 7 days.
- The courier sees the exact deadline and number of days remaining.
- If the deadline passes without full payment, the settlement becomes `OVERDUE`.

Inspect whether the system currently includes:

- Settlement periods.
- Billing cycles.
- Cycle start and end dates.
- Due dates.
- Grace periods.
- A job that closes settlement periods.
- A job that marks overdue settlements.
- Manual payment records.
- Notifications before payment deadlines.
- Courier suspension after overdue payment.
- Reopening or recalculating closed periods.
- Separate open, closed, due, and paid states.
- Historical settlement statements.

Document the current logic precisely.

---

## 8. Inspect the Current Admin Dashboard

Determine whether the current admin dashboard can:

- Change the default commission percentage.
- Configure the payment grace period.
- Select the accounting-cycle type:
  - Daily.
  - Weekly.
  - Semi-monthly.
  - Monthly.
- View all couriers.
- View order counts for each courier.
- View completed, cancelled, and returned orders.
- View total commission receivable.
- View overdue balances.
- Open a courier account statement.
- View all orders included in a settlement.
- Record an external manual payment.
- Record a partial payment.
- Add an adjustment.
- Waive an amount.
- Add notes to a settlement.
- Record who performed each admin action.
- Export a courier statement as CSV or Excel.
- Manually suspend a courier.
- Reactivate a courier.
- Filter couriers by settlement status.
- Filter settlements by date, city, state, and payment status.

Clearly separate:

- Fully implemented.
- Partially implemented.
- UI-only or mocked.
- Backend-only.
- Not implemented.
- Implemented but unnecessary for the MVP.

---

## 9. Required External Payment Recording Flow

Payments will happen outside the application.

The application only needs to record them manually.

Expected flow:

1. The courier pays the administration in cash or by an external transfer.
2. An authorized admin employee opens the courier account.
3. The employee records the amount paid.
4. The employee records the payment date.
5. The employee selects an informational payment method:
   - `CASH`
   - `BANK_TRANSFER`
   - `MOBILE_WALLET_EXTERNAL`
   - `OTHER`
6. The employee may enter an external reference number.
7. The employee may enter a note.
8. The system reduces the outstanding balance.
9. The system records an audit log containing the admin user who entered the payment.
10. The system does not call any payment provider.

Inspect whether this flow is currently supported.

Also inspect:

- Whether duplicate payment records can be created accidentally.
- Whether a payment can be edited or deleted.
- Whether corrections use reversal entries or destructive edits.
- Whether partial payments are calculated correctly.
- Whether overpayments are allowed.
- Whether a payment can be allocated across multiple settlements.
- Whether permissions prevent couriers and merchants from creating payment records.

---

## 10. Inspect Financial Accuracy and Security

Explain:

- Are monetary values stored as Integer, BigInt, Decimal, Numeric, or Float?
- Are there possible rounding problems?
- Is currency stored explicitly?
- Can an old completed order's commission be recalculated after settings change?
- Can an admin directly edit the commission amount of a completed order?
- Can a recorded payment be deleted?
- Is there an audit log?
- Is RBAC correctly enforced?
- Can a courier modify financial fields?
- Can a merchant view another courier's financial data?
- Can a basic admin employee change the global commission percentage?
- Is there idempotency to prevent duplicate commission creation?
- Can the same order generate commission twice?
- Are there unique database constraints to prevent duplicates?
- Do settlement and payment updates run inside database transactions?
- Are settlement totals calculated from immutable ledger entries or mutable aggregate columns?
- Are concurrent admin payment submissions handled safely?
- Are date calculations timezone-safe?
- Is the project's configured timezone appropriate for operations in Egypt?

---

## 11. Required Report Output

Create one new documentation file only:

`docs/Report.md`

Do not modify any production code, configuration, schema, migration, seed, test, or existing documentation file.

The report must contain the following sections.

### 1. Executive Summary

Provide a concise summary of the current situation, the most important gaps, and the overall MVP readiness.

### 2. Current Location Implementation

Document all current GPS, map, distance, navigation, geolocation, and tracking features.

### 3. Current Order Assignment Flow

Document how orders are created, exposed, accepted, assigned, cancelled, completed, and returned.

### 4. Current Pricing Logic

Document exactly how the delivery price is currently entered or calculated.

### 5. Current Financial Architecture

Document all financial tables, services, APIs, screens, providers, and environment configuration.

### 6. Current Courier Accounting

Document how courier orders, commission, liabilities, payments, balances, and statements are currently calculated.

### 7. Current Admin Capabilities

Document what administrators can currently view, configure, record, and export.

### 8. External Services and Expected Costs

List all external services that may generate costs.

For each service include:

- Service name.
- Purpose.
- Current usage.
- Required for MVP: yes or no.
- Pricing-risk category:
  - None.
  - Low.
  - Medium.
  - High.
- Recommended MVP action.

### 9. MVP Requirements Comparison

Create a table with these columns:

- Requirement.
- Current Status.
- Implemented Location.
- Evidence.
- Gap.
- Recommended Action.
- Priority.

Use only these statuses:

- `IMPLEMENTED`
- `PARTIALLY_IMPLEMENTED`
- `NOT_IMPLEMENTED`
- `IMPLEMENTED_BUT_NOT_NEEDED_FOR_MVP`
- `NEEDS_REDESIGN`

### 10. Recommended MVP Architecture

Recommend the simplest architecture that meets these requirements:

- No live courier tracking.
- No background GPS.
- No in-app payment processing.
- Courier-selected orders.
- Configurable platform commission.
- Commission snapshots.
- Courier ledger.
- Settlement periods.
- Manual external-payment recording.
- Admin audit logs.
- Courier account summary.
- Payment deadline and overdue status.

### 11. Files That Would Need Changes

List every file that would likely need to be changed in a later implementation task.

For each file include:

- Path.
- Current responsibility.
- Expected future change.
- Change priority.
- Whether the file should be modified, replaced, disabled, or left unchanged.

Do not change those files now.

### 12. Database Changes Needed

List the proposed:

- Models.
- Tables.
- Fields.
- Enums.
- Relationships.
- Indexes.
- Unique constraints.
- Check constraints.
- Audit fields.
- Idempotency keys.

Possible concepts to evaluate include:

- `PlatformSettings`
- `OrderFinancialSnapshot`
- `CourierLedgerEntry`
- `SettlementPeriod`
- `SettlementLine`
- `ExternalPaymentRecord`
- `FinancialAdjustment`
- `AuditLog`

Do not assume these exact names are required. Compare them with the existing schema and recommend the smallest coherent design.

### 13. API Changes Needed

List endpoints that should be:

- Added.
- Modified.
- Deprecated.
- Removed from MVP scope.
- Protected with stronger authorization.

Include recommended request and response responsibilities, but do not implement them.

### 14. UI Changes Needed

Describe the required changes for:

#### Courier Application

- Available orders.
- Accepted order details.
- External navigation buttons.
- Order history.
- Completed, cancelled, and returned counts.
- Commission due.
- Amount paid.
- Remaining balance.
- Settlement period.
- Payment deadline.
- Days remaining.
- Overdue status.

#### Merchant Application

- Order creation.
- Pickup and delivery addresses.
- Delivery fee.
- Order-status visibility.
- No default courier selection.
- No courier financial information.

#### Admin Dashboard

- Commission settings.
- Settlement-cycle settings.
- Grace-period settings.
- Courier list.
- Courier account statement.
- Manual payment recording.
- Partial payment.
- Adjustment and waiver.
- Audit history.
- Suspension and reactivation.
- CSV or Excel export.

### 15. Risks and Edge Cases

At minimum, analyze:

- Two couriers accepting the same order simultaneously.
- Courier cancellation after acceptance.
- Cancellation after pickup.
- Return after delivery.
- Commission already created before cancellation.
- Changing the global commission percentage.
- Historical orders.
- Partial payment.
- Duplicate payment submission.
- Overpayment.
- Manual adjustment.
- Settlement closing while an order status is changing.
- Order status inconsistent with settlement status.
- Courier suspension with an active order.
- Reopening a closed settlement.
- Timezone and deadline calculation.
- Admin editing or deleting financial records.
- Duplicate background-job execution.

### 16. Proposed Implementation Phases

Propose small implementation phases without executing them:

- **Phase A:** Remove or disable unnecessary tracking complexity.
- **Phase B:** Stabilize the available-order marketplace and atomic courier acceptance.
- **Phase C:** Add immutable commission snapshots.
- **Phase D:** Add courier ledger and settlement periods.
- **Phase E:** Add admin settlement and manual-payment tools.
- **Phase F:** Add the courier account and deadline screens.
- **Phase G:** Add tests, concurrency protection, auditability, and edge-case handling.

For each phase include:

- Objective.
- Exact scope.
- Expected files.
- Database impact.
- API impact.
- UI impact.
- Tests required.
- Dependencies.
- Definition of done.

### 17. Final Product Decisions Required

List only decisions that cannot be determined from the current code, including:

- Is a return treated as a new paid delivery?
- Does a return reverse the original commission?
- Is commission calculated only on the delivery fee?
- Is the accounting cycle weekly, semi-monthly, or monthly?
- How many grace-period days are allowed?
- Is courier suspension automatic after the deadline?
- Are partial payments allowed?
- Are overpayments allowed?
- Can a courier have a custom commission percentage?
- Can an administrator waive commission?
- At which order status is the commission finalized?
- Who is authorized to edit global financial settings?

---

## 12. Readiness Scores

At the end of the report, provide an evidence-based readiness score from 0 to 100 for:

- Location MVP.
- Available Order Marketplace.
- Order Acceptance Concurrency Safety.
- Pricing.
- Commission Snapshots.
- Courier Accounting.
- Settlement Periods.
- Admin Settlements.
- Manual Payment Recording.
- Financial Auditability.
- Overall Location and Finance MVP Readiness.

For each score, briefly explain:

- What is already complete.
- What is partially complete.
- What is missing.
- What blocks production readiness.

Do not give high scores based on placeholder screens, TODO comments, mocked services, or untested code.

---

## 13. Terminal Summary

After creating `docs/Report.md`, print a concise terminal summary containing:

- The 10 most important findings.
- The 5 highest-risk gaps.
- All services that may generate cost.
- The recommended first implementation phase.
- The readiness scores.
- The exact report path.

---

## Mandatory Rules

- Do not modify production code.
- Do not change the database schema.
- Do not create a migration.
- Do not install packages.
- Do not delete tracking or payment code.
- Do not execute destructive commands.
- Do not change environment variables.
- Do not change feature flags.
- Do not modify tests.
- Do not fix issues during this task.
- Do not claim a feature is implemented without code evidence.
- Include exact file paths for all findings.
- Include model, enum, service, endpoint, screen, worker, and test names where relevant.
- Clearly distinguish between:
  - Real implementation.
  - Mock implementation.
  - Placeholder implementation.
  - TODO-only behavior.
  - Unused code.
  - Future design.
- Inspect all relevant parts of the monorepo:
  - Backend/API.
  - Courier mobile application.
  - Merchant application.
  - Admin application.
  - Worker.
  - Shared packages.
  - Database schema.
  - Migrations.
  - Seeds.
  - Environment examples.
  - Feature flags.
  - Tests.
  - Existing documentation.
- Base all conclusions on evidence from the repository.
- The only permitted file creation is:

`docs/Report.md`
