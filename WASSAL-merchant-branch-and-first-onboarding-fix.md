# WASSAL Merchant Branch Visibility and First-Time Onboarding Fix

Inspect and fix the actual Merchant Web branch and first-time onboarding experience.

Current manual-test problems:

1. On the visible `المتجر والفريق` page, there is no visible `إضافة فرع جديد` button or branch-creation form, even when logged in as the seeded merchant owner.
2. A branch must have its own confirmed pickup location selected once through the same map-picker and Google Maps link experience used for customer locations.
3. The current application relies on seeded phone/password accounts, but a real merchant needs a first-time registration and onboarding flow.

First diagnose why the implemented branch button is not visible in the running Merchant Web. Check:

- The actual logged-in role returned by the session API.
- Role naming and role-condition mismatches.
- Whether `BranchCreationForm` is imported and rendered in the route currently shown to the user.
- Whether the button was added to a hidden or different settings section.
- Whether the running process is serving an old build.
- Whether hydration, runtime, or API errors prevent the component from rendering.

Then implement and verify the following.

## A. Visible Add-Branch Workflow

On the actual visible `المتجر والفريق` page:

- Show a prominent `إضافة فرع جديد` button for `merchant_owner` and `merchant_manager`.
- Do not show it for `merchant_staff`.
- Clicking it must open a clear modal or dedicated form.
- Do not hide it behind an unclear icon or collapsed technical section.

The form must include:

- Branch name.
- Branch phone.
- Governorate.
- City.
- Area.
- Street and detailed address.
- `تحديد موقع الفرع على الخريطة`.
- `استخدام موقعي الحالي`.
- `لصق رابط Google Maps`.
- Advanced manual coordinates only as a secondary option.

Use the existing freely navigable map picker.

The merchant must be able to:

- Pan and zoom freely.
- Select the exact branch location.
- Move the marker.
- Confirm the point.
- See whether it is inside an active service zone.

The branch cannot be submitted until its location is confirmed and inside an active service zone.

After successful creation:

- Refresh the branch list.
- Show the new branch immediately.
- Make it available as a pickup branch in new-order creation.
- Show a readable Arabic success message.

## B. First-Time Merchant Registration and Onboarding

Add a pilot-safe merchant registration flow using phone and password without SMS OTP for now.

The login page must include:

- `تسجيل الدخول`
- `إنشاء حساب تاجر جديد`

The registration flow must collect:

### Account

- Owner full name.
- Egyptian phone number.
- Password.
- Password confirmation.

### Business

- Business/merchant name.
- Business category.
- Contact phone.
- Optional email.

### First Branch

- Branch name.
- Full textual address.
- Confirmed map location.
- Google Maps link option.
- Current-device location option.
- Active service-zone validation.

On submission:

- Create the merchant owner account.
- Create the merchant.
- Create the first branch and its confirmed coordinates.
- Set the merchant/application status to pending review.
- Do not grant operational order creation until approval.
- Show a clear pending-review screen.

Admin must be able to view the registration and:

- Approve.
- Reject with reason.
- Request changes.

After approval, the merchant can log in with the registered phone and password.

Keep public unrestricted registration disabled behind a feature flag in production until SMS OTP is added. For the pilot, allow registration only when an explicit environment flag such as `MERCHANT_PILOT_REGISTRATION_ENABLED=true` is enabled.

Add rate limiting, password validation, duplicate-phone protection, audit records, and safe Arabic errors.

## C. Required Manual Verification

Run the Merchant Web and verify in the actual browser:

1. Login as seeded `merchant_owner`.
2. Open `المتجر والفريق`.
3. Confirm `إضافة فرع جديد` is visibly present.
4. Create a branch using the map.
5. Confirm the branch appears in the list.
6. Confirm it appears in the pickup-branch selector.
7. Login as `merchant_staff` and confirm the button is absent.
8. Open the login page and create a new pilot merchant account.
9. Create the first branch during onboarding.
10. Confirm the account remains pending before admin approval.
11. Approve it from Admin.
12. Login with the newly created phone and password.
13. Confirm the approved merchant can create orders.

Restart or rebuild the running Merchant Web if it is serving stale code.

Do not merely report that the component exists. Verify that the button is actually visible and usable in the same browser page the merchant sees.

Create a completion report at:

`docs/merchant-branch-and-first-onboarding-report.md`
