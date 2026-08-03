import { z } from 'zod';

import { isSupportedGoogleMapsReference } from './google-maps.js';

const normalizePhaseTwoPhone = (value: string) => {
  const compact = value.trim().replace(/[\s()-]/g, '');
  if (/^01(0|1|2|5)\d{8}$/.test(compact)) return `+20${compact.slice(1)}`;
  if (/^201(0|1|2|5)\d{8}$/.test(compact)) return `+${compact}`;
  if (/^00201(0|1|2|5)\d{8}$/.test(compact)) return `+${compact.slice(2)}`;
  return compact;
};
const phaseTwoPhoneSchema = z
  .string()
  .transform(normalizePhaseTwoPhone)
  .pipe(z.string().regex(/^\+20(10|11|12|15)\d{8}$/));
const phaseTwoCoordinatesSchema = z.object({
  latitude: z.number().min(22).max(31.7),
  longitude: z.number().min(24.6).max(36.9),
});

export const merchantLocationSourceSchema = z.enum([
  'SAVED_ADDRESS',
  'MAP_PICKER',
  'DEVICE_LOCATION',
  'GOOGLE_MAPS_LINK',
  'MANUAL_COORDINATES',
]);

export const customerInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: phaseTwoPhoneSchema,
  email: z.string().trim().email().max(320).optional(),
  notes: z.string().trim().max(2_000).optional(),
});

export const customerUpdateSchema = customerInputSchema
  .partial()
  .extend({ version: z.number().int().positive() });

const addressBaseSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    contactName: z.string().trim().min(2).max(160),
    contactPhone: phaseTwoPhoneSchema,
    addressLine: z.string().trim().min(5).max(500),
    street: z.string().trim().max(240).optional(),
    buildingNumber: z.string().trim().max(40).optional(),
    floor: z.string().trim().max(40).optional(),
    apartment: z.string().trim().max(40).optional(),
    landmark: z.string().trim().max(240).optional(),
    area: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    governorate: z.string().trim().min(2).max(120),
    instructions: z.string().trim().max(2_000).optional(),
    deliveryNotes: z.string().trim().max(2_000).optional(),
    sourceMapsUrl: z.string().trim().url().max(1_000).optional(),
    locationSource: merchantLocationSourceSchema.default('MANUAL_COORDINATES'),
  })
  .extend(phaseTwoCoordinatesSchema.shape);

const validateMapsLink = (
  input: { sourceMapsUrl?: string },
  context: z.RefinementCtx,
) => {
  if (
    input.sourceMapsUrl &&
    !isSupportedGoogleMapsReference(input.sourceMapsUrl)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['sourceMapsUrl'],
      message: 'Use a supported HTTPS Google Maps location URL.',
    });
  }
};

export const addressInputSchema =
  addressBaseSchema.superRefine(validateMapsLink);

export const addressUpdateSchema = addressBaseSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .superRefine(validateMapsLink);

export const packageDetailsSchema = z.object({
  category: z.enum([
    'groceries',
    'food',
    'pharmacy',
    'documents',
    'clothing',
    'gifts',
    'electronics_accessories',
    'spare_parts',
    'other',
  ]),
  itemDescription: z.string().trim().min(2).max(240),
  size: z.enum(['small', 'medium', 'large']),
  weightGrams: z.number().int().positive(),
  packageCount: z.number().int().positive().max(20).default(1),
  fragile: z.boolean().default(false),
  requiresThermalBag: z.boolean().default(false),
  recipientNotes: z.string().trim().max(2_000).optional(),
  courierNotes: z.string().trim().max(2_000).optional(),
  declaredValueMinor: z.number().int().nonnegative(),
  prohibitedItemsConfirmed: z.literal(true),
  merchantReference: z.string().trim().max(100).optional(),
  customerOrderReference: z.string().trim().max(100).optional(),
});

const quoteCustomerSchema = z.union([
  z.object({ customerId: z.string().uuid() }),
  customerInputSchema,
]);

const quoteDropoffSchema = z.union([
  z.object({ addressId: z.string().uuid() }),
  addressInputSchema.extend({ saveAddress: z.boolean().default(false) }),
]);

export const quoteRequestSchema = z.object({
  storeId: z.string().uuid(),
  customer: quoteCustomerSchema,
  dropoff: quoteDropoffSchema,
  package: packageDetailsSchema,
});

export const createOrderSchema = z.object({
  quoteId: z.string().uuid(),
  quoteVersion: z.number().int().positive(),
  locationReviewed: z.literal(true),
});

export const merchantCancellationReasons = [
  'customer_cancelled',
  'wrong_address',
  'duplicate_order',
  'order_not_ready',
  'incorrect_details',
  'no_longer_needed',
  'other',
] as const;

export const adminCancellationReasons = [
  'merchant_request',
  'suspected_fraud',
  'unsupported_item',
  'service_area_issue',
  'operational_issue',
  'duplicate_order',
  'other',
] as const;

export function cancellationSchema(reasons: readonly [string, ...string[]]) {
  return z
    .object({
      reasonCode: z.enum(reasons),
      details: z.string().trim().max(2_000).optional(),
      version: z.number().int().positive(),
    })
    .superRefine((input, context) => {
      if (input.reasonCode === 'other' && !input.details?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['details'],
          message: 'Details are required when the reason is other.',
        });
      }
    });
}

export const merchantCancellationSchema = cancellationSchema(
  merchantCancellationReasons,
);
export const retryCourierSearchSchema = z.object({
  version: z.number().int().positive(),
});
export const adminCancellationSchema = cancellationSchema(
  adminCancellationReasons,
);

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const idempotencyHeaderSchema = z.string().trim().min(16).max(128);
