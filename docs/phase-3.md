# WASSAL Phase 4 — Real-Time Operations, Delivery Disputes, Payment Proofs, Address UX, and Production Foundations

Implement Phase 4 of the WASSAL motorcycle delivery platform.

Phase 3 already implemented:

- Courier-selected available-order marketplace.
- Atomic first-courier-wins acceptance.
- Courier order lifecycle.
- External navigation to pickup and delivery locations.
- Configurable 20% platform commission.
- Courier ledger and weekly settlements.
- Manual external-payment recording by administrators.
- Courier and administrator financial summaries.
- No live GPS tracking.
- No in-app payment gateway.

Read the following before implementing:

- `docs/phase-3-implementation-report.md`
- `docs/architecture/phase-3-marketplace-accounting.md`
- `docs/api/phase-3-routes.md`
- Existing Phase 3 migrations, tests, contracts, RBAC rules, and UI flows.

Do not rewrite or weaken working Phase 3 behavior.

This phase must add:

1. Better merchant address and customer-location entry.
2. A final location-review step before order creation.
3. Real-time in-app order updates.
4. An in-app notification center.
5. A merchant delivery-dispute window.
6. A complete delivery-failure and return confirmation workflow.
7. Courier-uploaded payment proofs.
8. Administrator approval or rejection of payment proofs.
9. Phone-number and password authentication suitable for a controlled pilot.
10. Privacy policy and terms-of-use pages.
11. Production-readiness foundations and documentation.

Do not add:

- Live courier tracking.
- Background GPS.
- Courier location uploads.
- Embedded courier tracking maps.
- Paid routing APIs.
- Google Maps Directions API.
- Payment gateways.
- Automatic payouts.
- WhatsApp notifications.
- SMS notifications.
- SMS OTP in this phase.
- Customer accounts or a customer application.
- Electronic customer signatures.
- Customer photographs.

---

# 1. Fixed Product Decisions

## 1.1 Merchant and Customer Relationship

WASSAL directly serves:

- Merchants.
- Couriers.
- Platform administrators.

The customer receiving the order is not a WASSAL account holder in this MVP.

Do not create:

- Customer login.
- Customer OTP.
- Customer mobile application.
- Customer portal.
- Customer notification account.

Customer data exists only as delivery information provided by the merchant.

## 1.2 Customer Address Fields

The merchant should be able to enter:

- Customer name.
- Customer phone number.
- Governorate.
- City.
- Area or neighborhood.
- Street.
- Building number.
- Floor.
- Apartment.
- Nearby landmark.
- Delivery notes.
- Latitude.
- Longitude.
- Optional Google Maps location link.

Not every text field is mandatory.

Required fields:

- Customer phone number.
- At least one meaningful textual address or area description.
- A valid delivery location represented by latitude and longitude.
- Pickup store.
- Delivery service zone.
- Package information required by the existing quote flow.

Optional fields:

- Building number.
- Floor.
- Apartment.
- Nearby landmark.
- Additional notes.
- Google Maps link when coordinates are already known.

Do not force the merchant to fill every address-detail field.

The merchant may intentionally omit unavailable details.

## 1.3 Customer Location Selection

Improve the merchant experience so ordinary merchants do not need to manually understand raw latitude and longitude.

Support the following location-entry options:

### Option A: Paste a Maps Link

Allow the merchant to paste a supported Google Maps URL.

The application should attempt to extract coordinates safely from supported URL formats.

Requirements:

- Validate the URL.
- Accept only explicitly supported HTTPS domains and patterns.
- Reject unsafe or unsupported links.
- Do not make a paid maps API request.
- Do not execute arbitrary redirects.
- Show extracted coordinates for confirmation.
- If coordinates cannot be extracted locally, show a clear error and allow manual entry.

### Option B: Manual Coordinates

Retain direct latitude and longitude entry as an advanced fallback.

Validate:

- Numeric format.
- Egypt coordinate boundaries.
- Existing service-zone rules.
- Pickup and delivery zone compatibility.

### Option C: Simple Location Picker

If a zero-cost map implementation can be added without a paid API, it may be used for selecting a static pin.

However:

- Do not add paid tiles or routing.
- Do not add courier tracking.
- Do not add continuous geolocation.
- Do not increase production cost unnecessarily.

If a reliable zero-cost picker cannot be implemented within the existing architecture, use Maps-link extraction plus manual coordinates instead.

Do not block the rest of Phase 4 on an embedded map.

## 1.4 Address Review Before Order Creation

Add a mandatory review step after the quote is generated and before the final order is created.

The review screen must display:

- Customer name.
- Customer phone number.
- Pickup store name.
- Pickup textual address.
- Delivery textual address.
- Area/service-zone names.
- Delivery coordinates.
- A button to open the delivery location externally.
- Approximate distance.
- Approximate duration.
- Delivery price.
- Package summary.
- Fragile or thermal-bag indicators.
- Clear warning that the merchant is responsible for confirming the location.

Display an Arabic-first message equivalent to:

“Please confirm the customer location carefully. The courier will depend on this location to reach the customer.”

Actions:

- Edit customer details.
- Edit delivery location.
- Return to quote.
- Confirm and create order.

Do not create the order until the merchant explicitly confirms this review.

## 1.5 Distance Calculation

Keep the existing deterministic local distance provider.

Do not add a commercial road-routing provider.

The MVP may continue using:

- Haversine distance.
- Existing road-factor multiplier.
- Existing deterministic duration estimation.

Clearly label the distance and duration as approximate.

Do not describe them as actual road distance or guaranteed arrival time.

Preserve the existing versioned pricing and immutable snapshots.

---

# 2. Real-Time In-App Updates

## 2.1 Required Real-Time Behavior

When the application is open and connected, updates must appear without manual pull-to-refresh.

Implement real-time in-app updates for:

### Courier Application

- New eligible order becomes available.
- Available order is accepted by another courier and disappears.
- Merchant or administrator cancels an eligible order.
- Assigned order status changes.
- Courier account or settlement information changes.
- Payment proof status changes.
- In-app notification is created.

### Merchant Application

- Courier accepts an order.
- Courier starts travelling to pickup.
- Courier reaches pickup.
- Courier picks up the order.
- Courier starts delivery.
- Courier reaches drop-off.
- Courier marks the order delivered.
- Delivery fails.
- Courier starts returning to store.
- Merchant must confirm returned order.
- Order becomes completed.
- Order enters a delivery dispute.
- Administrator resolves a dispute.

### Admin Application

- New delivery dispute.
- New payment proof.
- Failed or returned delivery.
- Overdue courier settlement.
- Important courier/account operational changes.

## 2.2 Technical Approach

Use the simplest reliable real-time implementation compatible with the existing modular monolith.

WebSocket or Socket.IO may be used.

Requirements:

- Authenticate every connection.
- Authorize every subscribed channel.
- Do not allow a courier to subscribe to another courier’s private data.
- Do not allow a merchant to subscribe to another merchant’s orders.
- Do not expose courier financial information to merchants.
- Do not expose private customer details before courier acceptance.
- Support reconnect.
- Support event deduplication.
- Include stable event IDs.
- Include event timestamps.
- Include entity version where applicable.
- Refresh the authoritative REST resource after reconnect or version mismatch.
- Treat REST/database state as authoritative.
- Do not rely on WebSocket events as the only persistence mechanism.

Suggested channel concepts:

- Courier marketplace by eligible service zone.
- Courier-specific operational channel.
- Merchant-specific order channel.
- Admin operations channel.
- Admin finance channel.
- User notification channel.

Do not use real-time courier-location streams.

## 2.3 Application Closed

Push notifications while the application is fully closed are deferred.

Do not add:

- Firebase Cloud Messaging.
- Expo push notifications.
- Apple push notifications.
- Paid notification services.

Document clearly:

- Real-time updates work while the application is open and connected.
- Closed-application push notifications are a future phase.

---

# 3. In-App Notification Center

Create persisted in-app notifications.

A notification must include:

- User ID or role-target reference.
- Notification type.
- Title.
- Body.
- Related entity type.
- Related entity ID.
- Optional deep-link destination.
- Created timestamp.
- Read timestamp.
- Stable deduplication key.
- Optional metadata.

Support:

- Unread count.
- Notification list.
- Mark one as read.
- Mark all as read.
- Pagination.
- Opening the related order, settlement, dispute, or payment proof.
- Real-time delivery while the app is open.
- REST fallback.

## 3.1 Merchant Notifications

Create notifications for:

- Order successfully created.
- Courier accepted order.
- Courier arriving at store.
- Courier arrived at store.
- Courier picked up order.
- Courier in transit.
- Courier reached drop-off.
- Courier marked delivered.
- Delivery failed.
- Courier returning to store.
- Return awaiting merchant confirmation.
- Return confirmed.
- Delivery dispute created.
- Delivery dispute resolved.
- Order completed.
- Order cancelled.

## 3.2 Courier Notifications

Create notifications for:

- New eligible order available.
- Order accepted successfully.
- Assigned order cancelled before pickup.
- Return confirmed by merchant.
- Settlement closed.
- Payment deadline approaching.
- Settlement overdue.
- Payment proof submitted.
- Payment proof approved.
- Payment proof rejected.
- Accepted payment amount differs from submitted amount.
- Administrator created an adjustment or waiver.

Avoid sending excessive duplicate notifications for every marketplace refresh.

Use deduplication and meaningful operational events.

## 3.3 Admin Notifications

Create notifications for:

- New delivery dispute.
- New payment proof awaiting review.
- Payment proof with possible duplicate reference.
- Returned order awaiting intervention beyond a configured time.
- Overdue settlement.
- Failed settlement job.
- Financial reconciliation problem.

Do not add WhatsApp, email, or SMS delivery.

---

# 4. Delivery Completion and Merchant Dispute Window

## 4.1 No Electronic Proof of Delivery

Remove any requirement for:

- Electronic customer signature.
- Customer photograph.
- Delivery OTP.
- Customer account confirmation.
- Uploaded customer identity document.

The courier completes the physical delivery and presses:

`Mark as Delivered`

The courier may optionally enter a short delivery note.

Do not require a photo or digital signature.

## 4.2 Optional Paper Signature Outside the Application

A merchant or courier may use a physical paper delivery sheet operationally.

The paper may contain:

- Daily sequence number.
- Unique WASSAL order number.
- Customer name.
- Customer phone number.
- Delivery date.
- Customer or recipient handwritten signature.
- Notes.

This paper process is outside the application.

Do not attempt to manage, scan, or validate the paper in this phase.

The application must always show a unique readable order number that can be written or printed on the paper.

The paper signature may be presented manually to administration during a dispute, but it is not a required system field.

## 4.3 Delivered Status

When the courier presses “Mark as Delivered”:

- Validate that the courier is assigned to the order.
- Validate the current order status.
- Require order version.
- Require idempotency key.
- Record `deliveredAt`.
- Move the order to `DELIVERED`.
- Append a typed immutable order event.
- Create merchant notification.
- Start a merchant dispute window.
- Do not immediately move the order to `COMPLETED`.
- Do not immediately create the commission liability.

## 4.4 Dispute Window

Default dispute period:

- 24 hours from `deliveredAt`.

Store the period in versioned platform operational settings so it can be changed later.

Default:

- `deliveryDisputeWindowHours = 24`

Display to the merchant:

- Delivered timestamp.
- Exact dispute deadline.
- Time remaining.
- Action: `Report Not Delivered`

Display to the courier:

- Delivered.
- Awaiting merchant dispute window.
- Exact completion time if no dispute is submitted.

If no dispute is submitted before the deadline:

- Complete the order automatically.
- Set `COMPLETED`.
- Create the commission liability exactly once.
- Add the order to the relevant settlement.
- Append completion event.
- Notify merchant and courier.
- Preserve idempotency under duplicate worker execution.

Use the worker for automatic completion, but make the completion command independently idempotent and safe to execute manually by an authorized administrator.

## 4.5 Merchant Delivery Dispute

During the dispute window, authorized merchant users may press:

`Report Not Delivered`

The merchant must select a reason:

- Courier did not arrive.
- Customer says the order was not received.
- Courier delivered to the wrong person.
- Order was incomplete.
- Order was damaged.
- Courier marked delivered by mistake.
- Other.

Require a written note when:

- Reason is `OTHER`.
- Additional explanation is operationally necessary.

On dispute creation:

- Create a `DeliveryDispute`.
- Move the order from `DELIVERED` to `DELIVERY_DISPUTED`.
- Pause automatic completion.
- Do not create commission liability.
- Do not include the order in a settlement.
- Notify courier.
- Notify authorized administrators.
- Record actor, timestamp, reason, note, and order version.
- Append immutable order event.
- Write audit log.

Only one open delivery dispute may exist per order.

A merchant cannot dispute:

- Before `DELIVERED`.
- After the dispute deadline.
- After final dispute resolution.
- An order belonging to another merchant.

## 4.6 Courier Response to Dispute

Allow the assigned courier to view the dispute and submit one response containing:

- Response note.
- Optional statement that paper proof is available.
- Submitted timestamp.

Do not require uploading the paper proof in this phase.

The response must not resolve the dispute automatically.

## 4.7 Admin Dispute Resolution

Authorized operations administrators and super administrators may resolve the dispute.

Resolution options:

### Confirm Delivery

Use when administration accepts that delivery occurred.

Actions:

- Resolve dispute as `DELIVERY_CONFIRMED`.
- Move order to `COMPLETED`.
- Create one commission liability.
- Add to settlement.
- Append event.
- Write audit log.
- Notify merchant and courier.

### Confirm Not Delivered

Use when administration determines delivery did not occur.

Possible actions selected by admin:

- Return order to `DELIVERY_FAILED`.
- Move to `RETURNING_TO_STORE`.
- Mark as `RETURNED` after merchant confirmation.
- Cancel the order when operationally appropriate.

Do not create commission while unresolved.

If the order later completes through the return policy, follow the existing Phase 3 return accounting decision.

### Require Return

Use when the order or goods must be returned to the merchant.

Actions:

- Move to `RETURNING_TO_STORE`.
- Require merchant return confirmation.
- Keep the dispute resolution and return timeline linked.

Every resolution requires:

- Resolution reason.
- Administrator note.
- Actor.
- Timestamp.
- Idempotency key.
- Audit record.

Do not allow destructive deletion of disputes or resolutions.

---

# 5. Delivery Failure and Return Workflow

Preserve the existing typed return lifecycle but improve its operational detail.

## 5.1 Delivery Failure Reasons

When the courier cannot deliver, require a reason:

- Customer did not answer.
- Phone switched off.
- Wrong address.
- Customer not present.
- Customer refused the order.
- Customer requested cancellation.
- Incorrect order or amount information.
- Area inaccessible.
- Product/order problem.
- Vehicle or courier emergency.
- Other.

Require a note for `OTHER`.

Allow an optional note for all reasons.

On failure:

- Move order to `DELIVERY_FAILED`.
- Store structured failure reason.
- Store note.
- Record courier actor.
- Append event.
- Notify merchant.
- Notify operations admin if configured.
- Do not complete financially.

## 5.2 Return to Store

After failure, courier starts:

`RETURNING_TO_STORE`

When the courier reaches the merchant, the courier presses:

`Return Delivered to Merchant`

This does not finalize the return by itself.

Move to a state such as:

`RETURN_AWAITING_MERCHANT_CONFIRMATION`

Add this state if the current lifecycle does not represent it safely.

Notify the merchant.

## 5.3 Merchant Confirms Return

The merchant must confirm:

`Return Received`

The merchant may enter:

- Optional note.
- Condition:

  - Received intact.
  - Received damaged.
  - Received incomplete.
  - Other.

After confirmation:

- Move to `RETURNED`.
- Then apply the existing Phase 3 financial finalization policy.
- Preserve the original delivery fee.
- Create only one platform commission.
- Do not add a separate return-trip fee.
- Do not reverse the original commission.
- Append events.
- Write audit.
- Notify courier and admin as appropriate.

Do not let the courier alone confirm that the merchant received the returned order.

## 5.4 Admin Return Override

Allow operations admin or super admin to resolve returns that remain awaiting confirmation beyond a configurable operational period.

Require:

- Reason.
- Note.
- Audit log.

---

# 6. Courier Payment-Proof Submission

Phase 3 allows administrators to manually record an external payment.

Extend this process so the courier can submit proof before the administrator records the accepted payment.

## 6.1 Submission Flow

The courier opens the Account section and selects:

`Submit Payment Proof`

Display:

- Current outstanding amount.
- Oldest unpaid settlement.
- Payment deadlines.
- Warning that uploading proof does not automatically reduce the balance.

The courier enters:

- Submitted amount.
- Payment method:

  - `CASH`
  - `BANK_TRANSFER`
  - `MOBILE_WALLET_EXTERNAL`
  - `OTHER`

- Payment date/time.
- Optional external reference number.
- Required screenshot or receipt image.
- Optional note.

For `CASH`, allow an image of a signed receipt or other evidence.

The submitted amount must:

- Be greater than zero.
- Use EGP minor units.
- Not automatically change the ledger.
- Not automatically reduce any settlement.

## 6.2 Payment Proof Statuses

Add:

- `PENDING_CONFIRMATION`
- `APPROVED`
- `PARTIALLY_APPROVED`
- `REJECTED`
- `CANCELLED_BY_COURIER` when still pending
- `SUPERSEDED` if replaced safely

Normal submitted state:

`PENDING_CONFIRMATION`

Only one active pending review should exist for the same courier/reference/image fingerprint when clear duplication is detected.

Do not automatically reject a possible duplicate. Flag it for admin review.

## 6.3 Receipt Image Storage

Store the uploaded proof using a private object-storage abstraction.

Requirements:

- No public bucket or permanent public URL.
- Authenticated and authorized access only.
- Supported file types:

  - JPEG.
  - PNG.
  - WebP.
  - PDF only if the existing upload security supports it safely.

- Validate actual file signature, not extension only.
- Set strict file-size limit.
- Generate server-side object keys.
- Do not trust user filenames.
- Prevent executable uploads.
- Record checksum or content hash where practical.
- Record uploader, upload time, MIME type, and size.
- Use signed short-lived access URLs or authenticated download endpoint.
- Add retention policy documentation.
- Audit admin access where supported.

For local development, the existing local storage adapter may be used.

For production, document that S3-compatible private object storage is required.

Do not store receipt images inside PostgreSQL.

## 6.4 Admin Payment-Proof Review

Finance admin and super admin may review pending payment proofs.

Display:

- Courier identity.
- Submitted amount.
- Current outstanding balance.
- Settlement list.
- Payment method.
- Payment date.
- External reference.
- Image preview or secure download.
- Courier note.
- Submission timestamp.
- Possible duplicate warning.
- Previous proof submissions from the courier.

Admin actions:

### Approve Full Submitted Amount

Admin confirms the actual received amount equals the submitted amount.

The system must:

- Create the existing append-only external payment record.
- Allocate oldest outstanding settlements first.
- Reduce balances.
- Mark proof `APPROVED`.
- Link proof to the created payment.
- Notify courier.
- Audit the action.

### Approve a Different Amount

Admin enters the actual amount received.

If it is lower than the submitted amount:

- Mark `PARTIALLY_APPROVED`.
- Store submitted amount.
- Store approved amount.
- Require admin note explaining the difference.
- Create payment only for approved amount.
- Notify courier clearly.

Do not allow approved amount to:

- Exceed the courier’s current outstanding balance.
- Be less than or equal to zero.
- Exceed submitted amount without a super-admin override and mandatory reason.

### Reject

Require rejection reason:

- Image unclear.
- Amount does not match.
- Transfer not found.
- Duplicate proof/reference.
- Invalid evidence.
- Wrong recipient account.
- Other.

Require a note for `OTHER`.

On rejection:

- Do not create payment.
- Do not modify settlement balances.
- Mark proof `REJECTED`.
- Notify courier.
- Preserve proof and review history according to retention policy.
- Audit the action.

## 6.5 Admin Direct Payment Entry

Preserve the Phase 3 ability for finance admins to record a payment directly without courier proof.

Examples:

- Cash received at office.
- Old operational payment.
- Manual correction from supported accounting records.

The admin must be able to optionally link the direct payment to a payment proof.

All existing idempotency, overpayment rejection, allocation, reversal, and audit rules must remain.

---

# 7. Authentication for the Controlled Pilot

## 7.1 Login Method

For this controlled MVP pilot, use:

- Phone number.
- Password.

Do not require SMS OTP.

Do not add an SMS provider.

## 7.2 Registration Policy

Do not allow unrestricted anonymous public activation.

### Courier

- Courier can submit registration details.
- Account remains inactive or pending.
- Administrator verifies documents and activates the courier.
- Existing courier verification requirements remain.

### Merchant

Use one of the following supported controlled-pilot paths:

- Administrator creates merchant account.
- Merchant submits registration and awaits administrator approval.

Do not automatically activate an unverified merchant for unrestricted production use.

## 7.3 Phone Number Rules

- Normalize Egyptian phone numbers consistently.
- Enforce uniqueness.
- Do not allow ordinary users to change their phone number directly.
- Phone-number change requires administrator review in this pilot.
- Record phone changes in audit history.

## 7.4 Password Security

Requirements:

- Strong password hashing using the project’s existing secure password implementation.
- Never store plain-text passwords.
- Minimum password policy.
- Rate-limit login attempts.
- Temporary lockout after repeated failures.
- Session revocation after password reset.
- Audit suspicious repeated login attempts where appropriate.
- Do not expose whether a phone number exists through inconsistent error messages.

## 7.5 Password Reset

Because SMS OTP is deferred:

- Password reset is handled manually by an authorized administrator during the pilot.
- Admin issues a temporary reset process or temporary password using the safest existing pattern.
- Force password change on next login.
- Revoke existing sessions.
- Audit the reset.

Do not email or SMS the password.

Document that self-service password recovery requires verified SMS OTP in a future public-launch phase.

## 7.6 Deferred OTP

Explicitly document:

SMS OTP is required before unrestricted public registration for:

- Initial phone verification.
- Self-service password recovery.
- Phone-number change verification.

OTP is not required on every normal login.

Do not implement it in Phase 4.

---

# 8. Privacy Policy and Terms of Use

Create public pages in Arabic-first RTL with English support:

- `/privacy`
- `/terms`

Add visible links from:

- Login.
- Registration.
- Merchant application footer or settings.
- Courier application settings/about screen.
- Admin login where appropriate.

## 8.1 Privacy Policy Topics

The privacy page must clearly cover:

- Data controller/platform identity placeholder.
- Merchant account data.
- Courier identity and verification documents.
- Customer delivery data entered by merchants.
- Customer names, phone numbers, and addresses.
- Order history.
- Courier operational activity.
- Financial settlement records.
- Payment-proof screenshots and references.
- Delivery disputes.
- In-app notifications.
- Audit logs.
- No live courier tracking in the current MVP.
- No background GPS collection.
- Purpose of data processing.
- Who may access each category.
- Data retention.
- Security safeguards.
- User rights.
- Account deletion/request process.
- Legal and safety disclosure.
- Contact-information placeholder.
- Future policy update procedure.

Do not claim legal compliance that has not been verified.

Use clear placeholders for:

- Company legal name.
- Registered address.
- Privacy contact.
- Support contact.
- Effective date.

## 8.2 Terms of Use Topics

The terms page must cover:

- Platform role as delivery coordination and accounting system.
- Merchant responsibilities for accurate addresses and order information.
- Courier responsibilities.
- Customer-data responsibilities.
- Approximate distance and duration.
- No guarantee that offline estimated distance equals road distance.
- Delivery-dispute process.
- 24-hour merchant dispute window.
- Optional external paper-signature evidence.
- Return and failed-delivery process.
- Commission and settlement rules.
- External payment-proof submission.
- Admin approval before payment affects balance.
- Account suspension.
- Prohibited use.
- Limitation-of-liability placeholders requiring legal review.
- Account termination.
- Governing-law placeholder.
- Contact placeholder.
- Future amendments.

Mark both documents as drafts requiring review by a qualified Egyptian lawyer before public launch.

---

# 9. Production Foundations

This phase must improve production readiness without selecting expensive external services unnecessarily.

## 9.1 Environment Separation

Support:

- Development.
- Test.
- Staging.
- Production.

Requirements:

- Separate databases.
- Separate Redis instances.
- Separate object-storage buckets or prefixes.
- Separate secrets.
- Environment validation.
- No development mock OTP behavior in production.
- No production credentials committed to Git.

## 9.2 Domain and HTTPS Documentation

Document recommended deployment structure, such as:

- `api.<domain>`
- `merchant.<domain>`
- `admin.<domain>`
- Public legal pages under the merchant/public web application.

Requirements:

- HTTPS only in production.
- Secure cookies.
- Trusted proxy configuration.
- CORS allowlist.
- CSRF protection where applicable.
- HSTS recommendation.
- No wildcard production origins.

Do not purchase or configure a domain automatically.

Provide exact configuration requirements and placeholders.

## 9.3 Production Database

Requirements:

- Managed or reliably operated PostgreSQL with PostGIS.
- Automated daily backups.
- Point-in-time recovery recommendation.
- Restore-test runbook.
- Migration deployment process.
- Connection limit/pooling.
- Restricted database credentials.
- Monitoring for storage and connection exhaustion.

Do not hard-code a specific paid provider unless the repository already uses one.

## 9.4 Object Storage

Production object storage is required for:

- Courier verification documents.
- Payment-proof screenshots.
- Future dispute evidence if later added.

Requirements:

- Private S3-compatible storage.
- Encryption at rest.
- Least-privilege credentials.
- Signed temporary access.
- File retention.
- Safe deletion.
- Malware/file-signature controls.
- Backups or durability policy.

Keep local filesystem storage for development only.

## 9.5 Logs and Error Monitoring

Add or improve:

- Structured API logs.
- Worker job logs.
- Correlation/request IDs.
- User/actor IDs where safe.
- Order, settlement, dispute, and proof IDs.
- Error categorization.
- Secret and personal-data redaction.
- Health endpoints.
- Readiness/liveness endpoints.
- Job failure visibility.
- Reconciliation errors.

Do not log:

- Passwords.
- Tokens.
- Full payment-proof content.
- Full sensitive documents.
- Full customer phone numbers unnecessarily.
- Secrets.

A paid error-monitoring provider is not required now.

The implementation may use structured logs and documented future integration points.

## 9.6 Android Pilot Build

Create or document a reproducible Android pilot build process.

Requirements:

- Development build is not the production deliverable.
- Produce a signed internal-testing APK or AAB workflow.
- No location permission.
- Test external navigation.
- Test image upload.
- Test RTL.
- Test reconnect behavior.
- Test on multiple Android versions and screen sizes.
- Document environment/API base URL configuration.
- Do not commit signing keys.

## 9.7 Operational Roles and Runbooks

Document operational workflows for:

- Courier approval.
- Merchant approval.
- Courier service-zone assignment.
- Payment-proof review.
- Payment reversal.
- Delivery-dispute resolution.
- Return awaiting confirmation.
- Overdue settlement.
- Manual courier suspension.
- Password reset.
- Data-access request.
- Incident response.
- Database restore.
- Failed worker job.
- Financial reconciliation.

---

# 10. Database Design

Create one safe Phase 4 migration.

Preserve all Phase 1–3 data.

Evaluate and add the smallest coherent structures.

## 10.1 Address Improvements

Add structured optional address fields if not already present:

- Governorate.
- City.
- Area.
- Street.
- Building.
- Floor.
- Apartment.
- Landmark.
- Delivery notes.
- Source maps URL where safely useful.

Preserve latitude/longitude and PostGIS location.

Do not break existing saved addresses.

## 10.2 Operational Settings

Add versioned operational settings or extend an existing versioned platform-settings model:

- `deliveryDisputeWindowHours`, default 24.
- Return-confirmation timeout.
- Notification retention.
- Operations timezone remains `Africa/Cairo`.

Do not overwrite historical effective settings destructively.

Snapshot the relevant dispute deadline directly on each delivered order so a later settings change does not alter an active dispute window.

Suggested order fields:

- `deliveredAt`
- `deliveryDisputeDeadlineAt`
- `completedAt`
- `completionSource`

## 10.3 Delivery Dispute

Add an immutable/auditable dispute structure containing:

- Order.
- Merchant.
- Assigned courier.
- Status.
- Merchant reason.
- Merchant note.
- Created by.
- Created at.
- Courier response.
- Courier response timestamp.
- Resolution.
- Resolution note.
- Resolved by.
- Resolved at.
- Version.

Suggested statuses:

- `OPEN`
- `COURIER_RESPONDED`
- `RESOLVED_DELIVERY_CONFIRMED`
- `RESOLVED_NOT_DELIVERED`
- `RESOLVED_RETURN_REQUIRED`
- `CANCELLED_BY_ADMIN` only if operationally justified.

Constraints:

- At most one open dispute per order.
- Only delivered orders may enter dispute.
- Dispute created before deadline.
- Resolved disputes immutable except through explicit audit-safe correction.
- Commission finalization blocked while dispute open.

## 10.4 Notification

Add persisted notification model with:

- Recipient user.
- Type.
- Title/body localization keys or safe stored message.
- Related entity.
- Deduplication key.
- Read timestamp.
- Created timestamp.
- Expiry/retention fields if needed.

Add indexes for:

- Recipient + created time.
- Recipient + unread.
- Deduplication key.

## 10.5 Return Confirmation

Add fields or events required to distinguish:

- Courier reported return at merchant.
- Merchant confirmed receipt.
- Admin override.

Do not allow financial completion before required return confirmation or authorized resolution.

## 10.6 Payment Proof

Add:

- `CourierPaymentProof`
- Private file/object relation.
- Submitted and approved amount.
- Method.
- Payment date.
- Reference.
- Note.
- Status.
- Review reason.
- Reviewed by.
- Reviewed at.
- Linked external payment.
- Idempotency key.
- Version.
- Created/updated timestamps.

Keep original submission values immutable after review.

Corrections should use a replacement or superseding record.

Add duplicate-detection support using:

- Reference normalization.
- Optional image checksum.
- Courier + amount + payment date indicators.

Do not use duplicate indicators as unquestioned proof of fraud.

## 10.7 Append-Only and Audit Rules

Add database constraints or triggers where appropriate for:

- Payment-proof review history.
- Dispute resolution.
- Notification deduplication.
- Completion finalization.
- Commission entry uniqueness.
- Payment approval uniqueness.

Do not allow the same proof to create more than one external payment.

---

# 11. API Requirements

Follow existing `/api/v1` conventions.

## 11.1 Merchant Address and Review

Add or modify:

- Address create/update endpoints for structured optional fields.
- Maps-link coordinate extraction endpoint or server-side validation helper, only if needed.
- Quote response with full review summary.
- Order confirmation requiring explicit reviewed quote/version.

Do not trust client-calculated distance or price.

## 11.2 Real-Time

Add authenticated real-time handshake and event subscription design.

Also preserve REST endpoints for all authoritative resources.

Document event names and payload versions.

## 11.3 Notifications

Add:

- `GET /api/v1/notifications`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/:notificationId/read`
- `POST /api/v1/notifications/read-all`

Each user may access only their own notifications.

## 11.4 Merchant Delivery Dispute

Add:

- `POST /api/v1/merchant/orders/:orderId/delivery-disputes`
- `GET /api/v1/merchant/orders/:orderId/delivery-dispute`

Require:

- Merchant ownership.
- Current order version.
- Reason.
- Note where required.
- Idempotency key.
- Active dispute deadline.

## 11.5 Courier Dispute Response

Add:

- `GET /api/v1/couriers/orders/:orderId/delivery-dispute`
- `POST /api/v1/couriers/orders/:orderId/delivery-dispute/response`

Assigned courier only.

## 11.6 Admin Dispute Resolution

Add:

- `GET /api/v1/admin/delivery-disputes`
- `GET /api/v1/admin/delivery-disputes/:disputeId`
- `POST /api/v1/admin/delivery-disputes/:disputeId/resolve`

Support filters:

- Status.
- Merchant.
- Courier.
- Date.
- Reason.
- Overdue review.

## 11.7 Return Confirmation

Add merchant endpoint:

- `POST /api/v1/merchant/orders/:orderId/confirm-return`

Add admin override endpoint if required:

- `POST /api/v1/admin/orders/:orderId/confirm-return`

Require idempotency, version, reason for override, event, notification, and audit.

## 11.8 Courier Payment Proof

Add:

- `POST /api/v1/couriers/payment-proofs`
- `GET /api/v1/couriers/payment-proofs`
- `GET /api/v1/couriers/payment-proofs/:proofId`
- `POST /api/v1/couriers/payment-proofs/:proofId/cancel` when still pending

Use secure multipart or signed-upload flow consistent with existing document uploads.

## 11.9 Admin Payment-Proof Review

Add:

- `GET /api/v1/admin/payment-proofs`
- `GET /api/v1/admin/payment-proofs/:proofId`
- `POST /api/v1/admin/payment-proofs/:proofId/approve`
- `POST /api/v1/admin/payment-proofs/:proofId/reject`

Approval must call the existing external-payment accounting command rather than duplicating accounting logic.

---

# 12. UI Requirements

## 12.1 Merchant Application

Add or improve:

### Customer Address Form

- Structured address fields.
- Optional-detail labels.
- Paste Maps link.
- Coordinate extraction feedback.
- Manual coordinates fallback.
- Service-zone validation.
- Saved-address reuse.

### Quote and Location Review

- Pickup and delivery summaries.
- External location preview/open action.
- Approximate distance and duration.
- Price.
- Warning.
- Edit and confirm actions.

### Order Tracking

Update in real time.

Display:

- Current status.
- Courier acceptance.
- Delivery progress.
- Delivered timestamp.
- Dispute deadline.
- `Report Not Delivered` action.
- Open dispute.
- Resolution.
- Return awaiting merchant confirmation.
- `Confirm Return Received` action.

### Notifications

- Bell icon.
- Unread badge.
- Notification page.
- Deep links.

## 12.2 Courier Application

Add or improve:

### Real-Time Marketplace

- Orders appear without manual refresh while connected.
- Accepted orders disappear immediately for losing couriers.
- Connection status and reconnect indicator.
- REST refresh fallback.

### Active Order

- Mark delivered without OTP, photo, or electronic signature.
- Optional delivery note.
- Clear message that completion is pending the merchant dispute window.
- Exact expected finalization time.
- Delivery failure reasons.
- Return workflow.
- Return-awaiting-merchant-confirmation state.
- Dispute information and response.

### Account

Add:

- Submit payment proof.
- Proof status.
- Submitted amount.
- Approved amount.
- Rejection reason.
- Secure proof preview.
- Linked payment and resulting balance.

### Notifications

- Bell/tab badge.
- Notification list.
- Deep links.
- Read status.

Do not request location permission.

## 12.3 Admin Application

Add workspaces for:

### Delivery Disputes

- List.
- Filters.
- Order timeline.
- Merchant complaint.
- Courier response.
- Existing audit events.
- Resolution actions.
- Return-required action.
- Full role enforcement.

### Payment Proofs

- Pending queue.
- Image preview.
- Submitted/approved amount.
- Duplicate warnings.
- Courier balance and settlements.
- Approve full.
- Approve partial/different amount.
- Reject.
- Link to created external payment.
- Audit history.

### Notifications

- Operational badge.
- Finance badge where appropriate.
- Deep links.

### Operational Settings

- Delivery dispute window.
- Return confirmation timeout.
- History/versioning.
- Super-admin-only mutation.

---

# 13. RBAC Requirements

Add explicit permissions for:

- Own notifications read/update.
- Merchant order delivery dispute create/read.
- Courier dispute read/respond.
- Admin dispute read/resolve.
- Merchant return confirmation.
- Admin return override.
- Courier payment-proof create/read/cancel.
- Finance payment-proof read/approve/reject.
- Operational settings read/update.
- Private payment-proof file access.

Recommended policy:

- Merchant owner/manager:

  - Own order disputes.
  - Return confirmation.

- Merchant staff:

  - Decide explicitly whether staff may dispute/confirm return; default to manager/owner only.

- Courier:

  - Own disputes and payment proofs.

- Operations admin:

  - Resolve delivery disputes and operational returns.

- Finance admin:

  - Review payment proofs and record payments.

- Super admin:

  - All permissions and settings.

- Support:

  - Read-only operational dispute information where authorized.
  - No financial proof approval.

Add frontend role-aware visibility and backend guards.

---

# 14. Worker Jobs

Add idempotent jobs for:

## 14.1 Automatic Delivery Completion

Find delivered orders whose dispute deadline passed with no open dispute.

For each:

- Lock order.
- Recheck status and deadline.
- Recheck absence of open dispute.
- Complete financially exactly once.
- Create commission entry exactly once.
- Update settlement.
- Append event/audit.
- Notify merchant and courier.

## 14.2 Dispute/Return Reminders

Create in-app notifications for:

- Dispute awaiting admin review.
- Return awaiting merchant confirmation.
- Payment proof awaiting review.
- Approaching settlement deadline.

Do not send SMS, email, WhatsApp, or push.

## 14.3 Retention

Implement or document safe cleanup/archive jobs for:

- Expired read notifications.
- Superseded temporary upload objects.
- Abandoned uploads.

Do not delete audit, ledger, dispute, payment, or order history improperly.

---

# 15. Testing Requirements

Do not consider Phase 4 complete without full tests.

## 15.1 Unit Tests

Add tests for:

- Optional address fields.
- Required minimum address/location.
- Supported/unsupported Maps links.
- Coordinate extraction.
- Location review confirmation.
- Dispute-deadline calculation in `Africa/Cairo`.
- Allowed and expired merchant dispute creation.
- Only one open dispute.
- Delivery completion without dispute.
- Completion blocked by open dispute.
- Dispute resolution outcomes.
- Return awaiting merchant confirmation.
- Payment-proof statuses.
- Approved amount rules.
- Duplicate-proof indicators.
- Notification deduplication.
- Password/login rate-limit behavior.

## 15.2 Real-Time Integration Tests

Test:

- Authenticated connection.
- Unauthorized channel rejection.
- Merchant ownership isolation.
- Courier ownership isolation.
- New marketplace order event.
- Order removal after acceptance.
- Merchant receives courier-state update.
- Reconnect and REST reconciliation.
- Duplicate event handling.
- No tracking/location event channel exists.

## 15.3 Database Integration Tests

Test:

- Delivered order completes once after deadline.
- Duplicate worker execution creates one commission.
- Dispute blocks commission.
- Confirmed delivery resolution creates one commission.
- Not-delivered resolution creates none until valid finalization.
- One active dispute per order.
- One payment generated per approved proof.
- Proof approval is transactional.
- Rejection creates no ledger change.
- Private file metadata and ownership.
- Notification uniqueness.

## 15.4 E2E Journeys

### Successful Delivery Without Dispute

1. Merchant creates and confirms reviewed order.
2. Courier receives real-time availability event.
3. Courier accepts.
4. Merchant sees acceptance in real time.
5. Courier completes lifecycle.
6. Courier marks delivered.
7. Merchant sees dispute deadline.
8. No dispute submitted.
9. Deadline passes through controlled test clock.
10. Worker completes order.
11. Exactly one commission entry exists.
12. Merchant and courier receive notifications.

### Delivery Dispute

1. Courier marks delivered.
2. Merchant reports not delivered within 24 hours.
3. Order enters disputed state.
4. Commission is not created.
5. Courier responds.
6. Admin confirms delivery.
7. Order completes.
8. One commission is created.
9. Full audit trail exists.

Add a second dispute path where admin confirms not delivered and requires return.

### Failed Delivery and Return

1. Courier selects structured failure reason.
2. Courier starts return.
3. Courier reports arrival at merchant.
4. Merchant confirms return.
5. Order reaches returned/completed policy.
6. One commission only.
7. No separate return charge.
8. Notifications and events reconcile.

### Payment Proof

1. Courier uploads proof.
2. Status is pending.
3. Balance is unchanged.
4. Finance admin approves a smaller actual amount.
5. External payment is created for approved amount only.
6. Oldest settlements are allocated.
7. Proof becomes partially approved.
8. Courier receives notification.
9. Admin reverses payment.
10. Ledger and proof history remain auditable.

### Authorization

Test:

- Merchant cannot dispute another merchant’s order.
- Merchant cannot dispute after deadline.
- Courier cannot respond to another courier’s dispute.
- Operations admin cannot approve payment proof.
- Finance admin cannot resolve delivery dispute unless explicitly allowed.
- Courier cannot access another courier’s proof.
- Proof image is not publicly accessible.
- No SMS provider call exists.
- No location permission exists.
- No payment gateway exists.

---

# 16. Seed and Demo Data

Update deterministic seed data with:

- Structured customer addresses.
- Orders ready for location review.
- Delivered order inside dispute window.
- Delivered order past deadline.
- Open delivery dispute.
- Courier response.
- Resolved confirmed-delivery dispute.
- Failed delivery.
- Return awaiting merchant confirmation.
- Completed returned order.
- In-app notifications.
- Pending payment proof.
- Partially approved payment proof.
- Rejected payment proof.
- Private receipt-image metadata.
- Pilot merchant and courier accounts using phone/password.
- Operational settings with 24-hour dispute window.

Do not seed real personal data, real receipts, production secrets, or signing keys.

---

# 17. Documentation

Create or update:

- Phase 4 architecture.
- Real-time event protocol.
- Notification types.
- Address and location-entry policy.
- Delivery-dispute policy.
- Paper-signature operational note.
- Delivery completion/finalization logic.
- Failed-delivery and return flow.
- Payment-proof review flow.
- Private file-storage policy.
- Pilot authentication policy.
- Deferred OTP requirements.
- Production deployment checklist.
- Backup/restore runbook.
- Operational admin runbooks.
- Privacy-policy draft.
- Terms-of-use draft.
- Updated RBAC matrix.
- Updated API documentation.

Clearly state:

- No customer account.
- No customer OTP.
- No electronic proof of delivery.
- Paper signatures are optional external evidence.
- Merchant has a 24-hour dispute window.
- Commission is finalized only after the window or admin resolution.
- No live tracking.
- No background GPS.
- No SMS/WhatsApp notification.
- No payment gateway.
- Payment proof does not reduce liability until admin approval.
- Distance is approximate and calculated offline.

---

# 18. Verification Commands

Run all repository-standard checks.

At minimum:

- Formatting.
- Linting.
- Type checking.
- Unit tests.
- Database integration tests.
- E2E tests.
- Real-time integration tests.
- Production builds.
- Prisma validation.
- Clean migration deployment.
- Upgrade migration from Phase 3.
- Seed twice to verify idempotency.
- Object-upload security tests.
- Search confirming:

  - No `expo-location`.
  - No background tracking.
  - No Google Directions API.
  - No payment gateway.
  - No SMS provider.
  - No WhatsApp integration.
  - No electronic signature dependency.

Test production configuration validation without exposing secrets.

Do not suppress failing tests.

Do not use unsafe `any`, broad casts, disabled lint rules, or mocked success responses to claim completion.

---

# 19. Implementation Discipline

- Inspect the repository before creating new abstractions.
- Reuse Phase 3 audit, RBAC, idempotency, settlement, ledger, and transaction patterns.
- Keep REST/database state authoritative.
- Keep the modular monolith.
- Do not add microservices.
- Do not add paid providers.
- Do not add unnecessary dependencies.
- Keep Arabic-first RTL.
- Preserve English localization.
- Preserve integer minor-unit money.
- Preserve append-only financial history.
- Use compensating records and reversals.
- Preserve Phase 3 concurrency guarantees.
- Add real-time transport only for operational state, never courier GPS.
- Do not expose private customer or financial information through real-time payloads.
- Do not claim a feature is complete when it is only a UI mock.
- Do not replace production requirements with documentation only when implementation is required.

---

# 20. Required Completion Report

After implementation, create:

`docs/phase-4-implementation-report.md`

The report must include:

1. Executive summary.
2. Product decisions implemented.
3. Address and location UX.
4. Location review workflow.
5. Real-time architecture.
6. Notification architecture.
7. Delivery completion and dispute workflow.
8. Return confirmation workflow.
9. Payment-proof workflow.
10. Authentication changes.
11. Privacy and terms pages.
12. Database migration.
13. New and modified files.
14. New APIs.
15. UI changes.
16. RBAC changes.
17. Worker jobs.
18. Security controls.
19. Production-readiness changes.
20. Test coverage.
21. Verification commands and exact results.
22. Remaining limitations.
23. Deferred public-launch requirements.
24. Updated total MVP implementation percentage.

The terminal summary must include:

- Migration name.
- Tests passed.
- Build results.
- Real-time tests.
- Delivery-dispute tests.
- Payment-proof approval tests.
- Confirmation that commission is delayed until dispute resolution/deadline.
- Confirmation that no live tracking was added.
- Confirmation that no paid maps API was added.
- Confirmation that no SMS/OTP integration was added.
- Confirmation that no payment gateway was added.
- Exact implementation-report path.

Do not stop after producing a plan.

Implement the phase, migrate the database safely, update the applications, run the full verification suite, fix failures caused by this work, and produce the completion report.
