# Fix Merchant Order Creation Form and Map Picker

Improve the Merchant Web order-creation workflow.

There are currently three main problems:

1. The location map sometimes renders incorrectly, with part of the map area blank, pink, distorted, or only partially visible.
2. Creating an order returns the generic error: `The request data is invalid.`
3. Customer and recipient information is duplicated, and the form does not clearly distinguish required and optional fields.

Do not make unrelated Admin Web changes.

---

## 1. Fix the map picker rendering

### Current problem

When the merchant opens the map to select the customer delivery location or store location, part of the map container appears blank, pink, or incorrectly rendered.

The map must render across the complete available area.

### Required behavior

- Give the map container an explicit responsive height.
- The map must use 100% of the available width.
- Do not allow the modal, drawer, grid, or flex layout to reduce the map to half its expected width.
- Ensure the map container has a valid width, an explicit minimum height, and no hidden overflow that clips map tiles.
- Verify that the required map CSS is loaded exactly once.
- Ensure map tiles cover the full map container.
- Fix any incorrect `z-index`, modal overlay, flex sizing, or absolute-positioning issue.
- Do not display any pink, empty, or unrendered portion of the map.

When the map opens inside a modal, dialog, drawer, accordion, or previously hidden container:

- Wait until the container is visible.
- Call the map resize/invalidate-size operation.
- Recalculate the viewport after the modal opening animation completes.
- Recenter the map on the current marker.
- If a marker or service circle exists, fit the viewport around it.

For Leaflet, use the equivalent of:

```ts
map.invalidateSize();
```

after the map becomes visible.

Use a `ResizeObserver` or equivalent safe mechanism if the parent container can resize.

The map should work correctly on desktop, tablet, mobile, the create branch form, the create order form, and when editing an existing selected location.

### Map interaction

Allow the merchant to:

- Search for an address.
- Click the map to place a marker.
- Drag the marker.
- Paste a Google Maps link when supported by the existing project.
- Confirm the selected location.

After selection, store and display:

- Latitude.
- Longitude.
- Resolved address when available.

Do not require manually typing latitude or longitude.

---

## 2. Simplify customer and recipient information

### Current problem

The form asks for customer name and customer phone near the top, then asks again for recipient name and recipient phone.

The merchant should not enter the same data twice.

The email field is also unnecessary for the current delivery workflow.

### Required form structure

Use one section named:

`بيانات المستلم`

This section must contain only:

- Recipient name.
- Recipient phone.

Use these values as the final recipient/customer contact values sent to the API.

Remove the duplicate customer-name and customer-phone fields.

Remove the email field entirely from:

- The visible form.
- Frontend validation.
- The submitted request payload.

Do not require an email to create an order.

Do not make a database migration only to remove an unused nullable email column unless genuinely necessary. It is acceptable to leave an unused backend field in place temporarily, but the Merchant Web must not display or send it.

---

## 3. Required and optional fields

Clearly label every field in Arabic as either:

- `إجباري`
- `اختياري`

Do not rely only on an asterisk without an explanation.

### Required fields

The following fields must be required:

1. Pickup branch/store.
2. Recipient name.
3. Recipient phone.
4. Full textual address.
5. Customer delivery location selected on the map.
6. Latitude and longitude generated from the selected map location.
7. Service-zone validation must succeed before submission.

Arabic labels should clearly communicate this, for example:

- `اسم المستلم — إجباري`
- `هاتف المستلم — إجباري`
- `العنوان النصي الكامل — إجباري`
- `موقع التسليم على الخريطة — إجباري`

### Optional address fields

The following fields must remain optional:

- Street name.
- Building number.
- Floor.
- Apartment number.
- Landmark.
- Delivery notes.

Arabic labels:

- `اسم الشارع — اختياري`
- `رقم المبنى — اختياري`
- `الدور — اختياري`
- `رقم الشقة — اختياري`
- `علامة مميزة — اختياري`
- `ملاحظات للمندوب — اختياري`

Do not block order creation because an optional address-detail field is empty.

### Full textual address

The full textual address must be required even when a map location has been selected.

Explain it with helper text:

`اكتب عنوانًا واضحًا يمكن للمندوب قراءته، بالإضافة إلى تحديد الموقع على الخريطة.`

The map coordinates and textual address serve different purposes:

- Coordinates are used for distance, coverage and navigation.
- The textual address is used by the courier to understand the exact destination.

---

## 4. Fix generic request-validation errors

### Current problem

The API returns:

`The request data is invalid.`

The merchant cannot identify which value is wrong.

### Required behavior

Inspect the actual order-creation endpoint, DTO, schema, validator, and frontend payload.

Ensure the frontend request exactly matches the backend contract.

Check especially:

- Required property names.
- Nested object structure.
- Phone number type and format.
- Latitude and longitude types.
- Numbers accidentally submitted as strings.
- Empty strings submitted for optional numeric fields.
- `undefined`, `null`, and empty-string handling.
- Branch/store ID.
- Address field names.
- Service-zone confirmation.
- Price or distance values that should be generated server-side.
- Duplicate or obsolete customer/recipient fields.
- Email accidentally required by the backend.
- Enum values and casing.

Do not send optional empty fields as invalid values.

Normalize optional form values before submission:

- Empty optional strings should be omitted or converted to the backend-supported null value.
- Empty optional numeric values must not be sent as empty strings.
- Latitude and longitude must be numbers.
- Trim required text values before validation.

### Field-level validation

Replace the generic error where possible with clear Arabic field errors.

Examples:

- `اسم المستلم مطلوب.`
- `رقم هاتف المستلم مطلوب.`
- `رقم الهاتف غير صحيح.`
- `العنوان النصي مطلوب.`
- `يرجى تحديد موقع التسليم على الخريطة.`
- `موقع التسليم خارج نطاق الخدمة.`
- `الفرع المحدد غير صالح.`
- `تعذر إنشاء الطلب بسبب بيانات غير صحيحة.`

If the backend returns structured validation issues, map each issue to its corresponding form field.

Display:

- Inline validation under the affected field.
- A concise Arabic summary at the top of the form.
- The first invalid field should receive focus or scroll into view.

Do not expose raw JSON, stack traces, or internal validation names to the merchant.

### Backend error response

When validation fails, the API should return a structured response where compatible with the existing project conventions, for example:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "بيانات الطلب غير صحيحة.",
  "fields": {
    "recipientName": "اسم المستلم مطلوب.",
    "recipientPhone": "رقم هاتف المستلم غير صحيح.",
    "deliveryAddress": "العنوان النصي مطلوب."
  }
}
```

Preserve existing global error conventions when possible.

---

## 5. Recommended final form layout

The final Arabic RTL form should use this order:

### بيانات الاستلام

- Pickup branch/store — required.
- Display the selected branch address and map location.
- Do not ask the merchant to re-enter the branch location for every order.

### بيانات المستلم

- Recipient name — required.
- Recipient phone — required.
- No email field.
- No duplicate name or phone fields.

### عنوان التسليم

- Full textual address — required.
- Select delivery location on map — required.
- Street name — optional.
- Building number — optional.
- Floor — optional.
- Apartment number — optional.
- Landmark — optional.

### تفاصيل الطلب

- Order details/items according to the existing implementation.
- Courier notes — optional.

### Price and distance

- Calculate using the existing pricing and routing logic.
- Do not ask the merchant to enter distance manually.
- Clearly show calculation errors before allowing submission.

---

## 6. Payload compatibility

Use one canonical recipient representation.

Prefer a payload structure consistent with the existing API, such as:

```ts
{
  storeId: string,
  recipient: {
    name: string,
    phone: string
  },
  deliveryAddress: {
    formattedAddress: string,
    street?: string,
    buildingNumber?: string,
    floor?: string,
    apartment?: string,
    landmark?: string,
    latitude: number,
    longitude: number
  },
  notes?: string
}
```

This is an example only.

First inspect the actual backend DTO and adapt the frontend to it instead of creating a conflicting parallel contract.

Remove obsolete duplicated properties from the frontend payload.

If the backend currently requires both customer and recipient objects for compatibility:

- Populate them server-side or through one canonical frontend source.
- Do not display duplicate fields to the merchant.
- Do not ask the merchant to type the same information twice.

---

## 7. Service-zone validation

Before submitting the order:

- Confirm that the selected branch is valid.
- Confirm that the delivery coordinates are inside an active service zone.
- Confirm that the actual route respects the maximum route-distance rule.
- Display the exact failed condition.

Differentiate between:

- `موقع التسليم خارج نطاق الخدمة.`
- `المسافة الفعلية للطلب تتجاوز الحد الأقصى المسموح.`
- `تعذر حساب المسافة، حاول تحديد الموقع مرة أخرى.`

Do not return only `The request data is invalid` for service-zone or route failures.

---

## 8. Verification

Test all of the following:

1. Open the delivery-location map on desktop.
2. Verify the complete map renders with no pink or blank half.
3. Resize the browser and verify the map remains correct.
4. Open and close the map modal several times.
5. Select a location and verify latitude and longitude update.
6. Create an order using only the required fields.
7. Verify optional address fields can remain empty.
8. Verify no email is required or submitted.
9. Verify recipient name and phone are entered only once.
10. Submit without a recipient name and verify a clear Arabic error.
11. Submit without a phone and verify a clear Arabic error.
12. Submit without a textual address and verify a clear Arabic error.
13. Submit without selecting a map location and verify a clear Arabic error.
14. Submit an out-of-zone location and verify a specific coverage error.
15. Submit a valid order and verify it is created successfully.
16. Confirm that no generic validation error is shown when a specific error is available.
17. Run relevant unit tests, API tests, type checks, lint and production builds.

After implementation, report:

- Root cause of the partially rendered map.
- Root cause of `The request data is invalid.`
- Exact frontend payload before and after the fix.
- Fields removed from the form.
- Fields marked required and optional.
- Files changed.
- API or DTO changes, if any.
- Test and build results.
