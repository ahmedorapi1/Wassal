# Fix the Actually Rendered New Order Form

A previous implementation report claimed that duplicate customer fields and email were removed, but the currently rendered Merchant Web page still shows them.

This means the previous changes did not affect the actual frontend component rendered by the "إنشاء طلب جديد" route.

Do not repeat the previous implementation blindly.

## Required investigation first

Before changing code:

1. Trace the exact route opened by the Merchant Web "إنشاء طلب جديد" button.
2. Identify the exact React component tree rendered on that route.
3. Report the exact file and component that currently render:
   - اسم العميل
   - رقم الموبايل
   - البريد الإلكتروني
   - اسم المستلم
   - هاتف المستلم
4. Search the entire Merchant Web codebase for all occurrences of:
   - `اسم العميل`
   - `رقم الموبايل`
   - `البريد الإلكتروني`
   - `اسم المستلم`
   - `هاتف المستلم`
   - `customerName`
   - `customerPhone`
   - `customerEmail`
   - `contactName`
   - `contactPhone`
5. Identify unused, legacy, duplicated, desktop, mobile, or feature-flagged order forms.
6. Explain why the previous change did not alter the visible frontend.

Do not claim completion until the exact visible route has been verified.

## Keep the current customer mode

Keep:

- عميل جديد
- عميل محفوظ

Do not remove this selector.

## Required visible form

### When "عميل جديد" is selected

Show only:

- اسم العميل — إجباري
- رقم الموبايل — إجباري

Remove from the visible form:

- البريد الإلكتروني
- اسم المستلم
- هاتف المستلم
- Any second name field
- Any second phone field
- Any duplicated contact section

### When "عميل محفوظ" is selected

Allow selecting the saved customer.

Populate the same one visible name and phone source internally.

Do not show:

- Email
- A separate recipient-name field
- A separate recipient-phone field

## Canonical values

Use one canonical name and one canonical phone:

```ts
const contactName = customerName.trim();
const contactPhone = normalizePhone(customerPhone);
```

If the backend contract requires both customer and dropoff contact values, populate both from the same source:

```ts
customer: {
  name: contactName,
  phone: contactPhone
},
dropoff: {
  contactName,
  contactPhone
}
```

The merchant must enter the name and phone only once.

## Remove email from this workflow

Remove email from:

- The actual rendered JSX.
- Component state.
- Form defaults.
- Validation.
- Quote payload.
- Create-order payload.
- Error mapping.
- Order-form tests.

A nullable email field may remain in the database if used elsewhere.

## Browser verification is mandatory

After implementation:

1. Start the Merchant Web on its actual port.
2. Open the exact "إنشاء طلب جديد" route used by the app.
3. Verify the rendered DOM does not contain:
   - البريد الإلكتروني
   - اسم المستلم
   - هاتف المستلم
4. Verify:
   - اسم العميل appears exactly once.
   - رقم الموبايل appears exactly once.
5. Test both:
   - عميل جديد
   - عميل محفوظ
6. Create a valid quote and order.
7. Capture or report the rendered labels found on the page.

If an in-app browser cannot attach:

- Add a focused React Testing Library test against the actual route/component.
- Assert the duplicate labels are absent.
- Assert the retained fields occur exactly once.
- Do not claim visual verification if it was not performed.

## Required automated assertions

Add a test for the actual rendered new-order page:

```ts
expect(screen.queryByLabelText(/البريد الإلكتروني/)).not.toBeInTheDocument();
expect(screen.queryByLabelText(/اسم المستلم/)).not.toBeInTheDocument();
expect(screen.queryByLabelText(/هاتف المستلم/)).not.toBeInTheDocument();

expect(screen.getAllByLabelText(/اسم العميل/)).toHaveLength(1);
expect(screen.getAllByLabelText(/رقم الموبايل/)).toHaveLength(1);
```

Adapt selectors to the actual markup, but preserve the assertion meaning.

## Required report

Report:

- Exact route.
- Exact visible component.
- Exact file that previously remained unchanged.
- Why the earlier implementation report did not match the UI.
- Legacy or duplicate forms found.
- Files changed.
- Before and after rendered labels.
- DOM or browser verification result.
- Quote/order result.
- TypeScript, lint, test, and build results.
