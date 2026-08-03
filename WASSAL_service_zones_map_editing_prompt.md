# WASSAL Admin — Service Zones Map Selection, Editing, Activation and Deactivation

Improve the Admin Web service-zone creation, editing, activation, deactivation, and map-selection experience.

## Current Problems

The current service-zone form asks the admin to manually enter:

- North boundary
- South boundary
- East boundary
- West boundary

This is difficult and should be removed from the user interface.

Also, an existing service zone cannot be edited properly. To change its radius, the admin currently has to:

1. Deactivate the existing zone.
2. Create another zone with the same name and center.
3. Enter a different radius.

This creates duplicate zones and is not an acceptable workflow.

## Required Service-Zone Creation UX

Replace the manual geographic-boundary fields with an interactive map-based center-and-radius selector.

The admin flow should be:

1. Enter the service-zone name.
2. Select or enter the governorate and city.
3. Enter the service radius in kilometers.
4. Enter the maximum delivery route distance in kilometers when it is stored as a separate setting.
5. Click an Arabic button labeled:

   `تحديد مركز المنطقة على الخريطة`

6. Open the existing map picker in a modal or a large map section.
7. Allow the admin to:
   - Search for a city, district, or address.
   - Click anywhere on the map to choose the zone center.
   - Drag the marker to update the center.
   - Use the current map center when needed.
8. Display a circle around the selected marker using the entered service radius.
9. Update the circle immediately when the radius changes.
10. Fit the map viewport so the entire service circle is visible.
11. Display the selected latitude, longitude, and radius as read-only information below the map.
12. Allow reopening the map to edit an existing zone.

## Important Business Distinction

Do not confuse the service-zone radius with the maximum delivery route distance.

- The service-zone radius determines whether a branch or delivery location is covered geographically.
- The maximum delivery route distance validates the actual road route for an order.

A location can be inside a 25 km straight-line service radius while its actual road route exceeds 25 km.

When both settings exist, store and validate them separately:

- `radiusKm`
- `maximumRouteDistanceKm`

## Data and Compatibility

Store the selected values as:

- `centerLatitude`
- `centerLongitude`
- `radiusKm`

If the existing API or database still requires north, south, east, and west bounds, calculate those values automatically from the selected center and radius.

Do not ask the admin to enter geographic boundaries manually.

Preserve compatibility with the existing service-zone API and database unless a schema change is genuinely required.

## Validation

- Zone name is required.
- Governorate is required.
- City should be stored when available.
- A map center must be selected.
- Radius must be greater than zero.
- Maximum route distance must be greater than zero when enabled.
- Reject invalid latitude or longitude values.
- Show clear Arabic validation and success/error messages.
- Prevent saving until a valid center and radius exist.

## Branch Coverage Validation

When a merchant selects a branch location, validate whether the branch coordinates fall inside at least one active service zone.

For circle-based zones, calculate the geographic distance between:

- The service-zone center.
- The selected branch coordinates.

The branch is inside the zone when:

```text
distance <= radiusKm
```

Use an accurate geographic-distance calculation such as:

- PostGIS `ST_DWithin` with geography types, or
- An equivalent Haversine implementation.

Inactive zones must not be used to validate new merchant branch locations.

## Order Validation

For new orders:

1. Confirm the required pickup and delivery locations are covered by an active service zone according to the existing business rules.
2. Calculate the actual road-route distance.
3. Reject the order when the actual route exceeds `maximumRouteDistanceKm`, when that setting exists.

The service radius must not replace the route-distance check.

## Service-Zone List

Display all service zones in a clear Arabic RTL table or responsive card list.

Each service zone must show:

- Zone name.
- Governorate.
- City, when available.
- Status:
  - `فعّالة`
  - `متوقفة`
- Service radius in kilometers.
- Maximum delivery route distance, if stored separately.
- Last updated date.
- Available actions.

Center coordinates should be hidden under details rather than displayed prominently.

Provide the following actions for every zone:

- `عرض على الخريطة`
- `تعديل`
- `إيقاف` when the zone is active.
- `تفعيل` when the zone is inactive.

Do not require creating a new zone to change an existing zone.

## Edit Existing Zone

When the admin clicks `تعديل`, open the existing zone form populated with its current values.

Allow editing:

- Zone name.
- Governorate.
- City.
- Map center.
- Service radius.
- Maximum route distance, if it is a separate setting.
- Active/inactive status.

The map must display:

- The existing center marker.
- The current coverage circle.
- The current radius.
- The complete zone inside the map viewport.

When the admin changes the radius, update the circle immediately.

When the admin selects or drags a new center, update the marker and circle immediately.

Save changes to the same service-zone record.

Do not create a duplicate record.

Use `PATCH` or `PUT` according to the existing API conventions.

Updating a zone must preserve its existing ID.

## Activation and Deactivation

Allow the admin to deactivate an active service zone directly from the list.

Use an Arabic confirmation dialog.

### Deactivation Dialog

Title:

`إيقاف منطقة الخدمة`

Message:

`هل تريد إيقاف منطقة {zoneName}؟ لن يتم قبول فروع أو طلبات جديدة داخل هذه المنطقة، ولن تتأثر الطلبات الجارية حاليًا.`

Actions:

- `إلغاء`
- `تأكيد الإيقاف`

When a zone is inactive:

- Do not use it when validating new merchant branch locations.
- Do not use it when validating new orders.
- Do not delete the zone.
- Preserve its center, radius, pricing references, and historical data.
- Existing in-progress orders must not be cancelled automatically.

Allow reactivation using a button labeled:

`تفعيل`

Show a suitable confirmation before reactivation.

Use a dedicated status endpoint or a `PATCH` operation according to the existing API conventions.

## Existing Branches After Zone Changes

After increasing or decreasing a zone radius:

- New branch validations must use the updated radius immediately.
- New order validations must use the updated zone immediately.
- Previously accepted branches should remain stored.
- Do not delete or silently deactivate existing branches.

If an existing branch becomes outside all active service zones after reducing the radius, display a visible status such as:

`خارج نطاق الخدمة الحالي`

The merchant should be informed clearly, but the branch record and its historical data must remain intact.

## Duplicate Prevention

Prevent duplicate active zones with exactly the same:

- Name.
- Center.
- Radius.

Do not block legitimate overlapping zones when they represent different cities, service tiers, or operational purposes.

If zones overlap, validation should still work safely and should not create duplicate side effects.

## UI Requirements

- Arabic RTL.
- Responsive on desktop and tablet.
- Use the existing WASSAL Admin design system.
- Do not expose raw north/south/east/west inputs.
- Clearly shade the covered area on the map.
- Show a marker at the zone center.
- Show the radius in kilometers on the map and form.
- Support both creating and editing service zones.
- Disable action buttons while a request is being processed.
- Refresh the zones list after every successful create, update, activation, or deactivation request.
- Show clear Arabic success and error messages.
- Show the API error clearly when an operation fails.
- Clicking the zone name or card should open its details page or edit view.

## Auditability

Record the following when supported by the existing audit system:

- Who created or edited the zone.
- Previous radius and new radius.
- Previous center and new center.
- Previous status and new status.
- Maximum route-distance changes.
- Date and time of the change.

## Safety and Historical Integrity

- Do not delete historical orders.
- Do not delete merchant branches automatically.
- Do not break pricing references.
- Do not change previous order calculations retroactively.
- Preserve the existing zone ID during edits.
- Preserve existing database relations.
- Avoid unnecessary database or API changes.

## Verification

Test all of the following:

1. Create a zone centered in New Damietta with a 25 km radius.
2. Verify that changing the radius updates the map circle immediately.
3. Verify that the map viewport fits the complete coverage circle.
4. Verify that a branch inside the circle is accepted.
5. Verify that a branch outside the circle is rejected.
6. Verify that an inactive zone does not accept new branch locations.
7. Verify that an inactive zone is excluded from new order validation.
8. Open an existing active Damietta zone with a 25 km radius.
9. Edit the same zone and increase its radius to 35 km.
10. Verify that the same zone ID is preserved.
11. Verify that no duplicate zone is created.
12. Verify that the map restores the existing marker and circle.
13. Verify that branch validation uses the new 35 km radius immediately.
14. Reduce the radius and verify that existing out-of-zone branches remain stored and are marked clearly.
15. Deactivate the zone from the service-zones list.
16. Verify that existing in-progress orders remain unchanged.
17. Reactivate the same zone.
18. Verify that validation starts using it again.
19. Verify that maximum route distance is validated separately from the service radius.
20. Run relevant unit tests, integration tests, type checks, lint checks, and production builds.

## Required Implementation Report

After implementation, report:

- Files changed.
- API endpoints added or modified.
- Database changes, if any.
- The geographic-distance method used.
- How automatic bounds are calculated if the legacy API still requires them.
- How existing branches outside a reduced zone are handled.
- How service radius and maximum route distance are kept separate.
- Manual testing steps.
- Test, type-check, lint, and build results.
