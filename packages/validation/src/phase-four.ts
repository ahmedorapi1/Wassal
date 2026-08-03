import { z } from 'zod';

import { isSupportedGoogleMapsReference } from './google-maps.js';

export {
  extractGoogleMapsCoordinates,
  googleMapsReferenceKind,
  isSupportedGoogleMapsReference,
} from './google-maps.js';

export const egyptCoordinatesSchema = z.object({
  latitude: z.coerce.number().min(22).max(31.7),
  longitude: z.coerce.number().min(24.6).max(36.9),
});

export const phaseFourAddressFieldsSchema = z
  .object({
    street: z.string().trim().max(240).optional(),
    deliveryNotes: z.string().trim().max(2_000).optional(),
    sourceMapsUrl: z.string().trim().url().max(1_000).optional(),
  })
  .superRefine((input, context) => {
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
  });

export const deliveryDisputeReasons = [
  'COURIER_DID_NOT_ARRIVE',
  'CUSTOMER_DID_NOT_RECEIVE',
  'WRONG_RECIPIENT',
  'INCOMPLETE_DELIVERY',
  'DAMAGED_DELIVERY',
  'MARKED_DELIVERED_BY_MISTAKE',
  'OTHER',
] as const;

export const deliveryDisputeSchema = z
  .object({
    version: z.coerce.number().int().positive(),
    reason: z.enum(deliveryDisputeReasons),
    note: z.string().trim().max(2_000).optional(),
  })
  .superRefine((input, context) => {
    if (input.reason === 'OTHER' && !input.note) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note is required for the OTHER reason.',
      });
    }
  });

export const courierDisputeResponseSchema = z.object({
  version: z.coerce.number().int().positive(),
  response: z.string().trim().min(2).max(2_000),
  paperProofAvailable: z.boolean().default(false),
});

export const disputeResolutionSchema = z.object({
  version: z.coerce.number().int().positive(),
  resolution: z.enum([
    'CONFIRM_DELIVERY',
    'CONFIRM_NOT_DELIVERED',
    'REQUIRE_RETURN',
  ]),
  note: z.string().trim().min(2).max(2_000),
});

export const deliveryFailureReasons = [
  'CUSTOMER_NO_ANSWER',
  'PHONE_OFF',
  'WRONG_ADDRESS',
  'CUSTOMER_ABSENT',
  'CUSTOMER_REFUSED',
  'CUSTOMER_CANCELLED',
  'INCORRECT_INFORMATION',
  'INACCESSIBLE_LOCATION',
  'PRODUCT_ISSUE',
  'COURIER_EMERGENCY',
  'OTHER',
] as const;

export const deliveryFailureSchema = z
  .object({
    version: z.coerce.number().int().positive(),
    reason: z.enum(deliveryFailureReasons),
    note: z.string().trim().max(2_000).optional(),
  })
  .superRefine((input, context) => {
    if (input.reason === 'OTHER' && !input.note) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note is required for the OTHER reason.',
      });
    }
  });

export const returnConfirmationSchema = z
  .object({
    version: z.coerce.number().int().positive(),
    condition: z.enum(['INTACT', 'DAMAGED', 'INCOMPLETE', 'OTHER']),
    note: z.string().trim().max(2_000).optional(),
  })
  .superRefine((input, context) => {
    if (input.condition === 'OTHER' && !input.note) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note is required for the OTHER condition.',
      });
    }
  });

export const returnOverrideSchema = returnConfirmationSchema.extend({
  reason: z.string().trim().min(2).max(2_000),
});

export const paymentProofMetadataSchema = z.object({
  amountMinor: z.coerce.number().int().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_WALLET_EXTERNAL', 'OTHER']),
  paidAt: z.coerce.date(),
  externalReference: z.string().trim().max(160).optional(),
  note: z.string().trim().max(2_000).optional(),
});

export const paymentProofApprovalSchema = z.object({
  version: z.coerce.number().int().positive(),
  approvedAmountMinor: z.coerce.number().int().positive(),
  reason: z.string().trim().max(2_000).optional(),
});

export const paymentProofRejectionSchema = z.object({
  version: z.coerce.number().int().positive(),
  reason: z.string().trim().min(2).max(2_000),
});

export const operationalSettingSchema = z.object({
  deliveryDisputeWindowHours: z.coerce.number().int().min(1).max(168),
  returnConfirmationTimeoutHours: z.coerce.number().int().min(1).max(720),
  notificationRetentionDays: z.coerce.number().int().min(1).max(3650),
});

export const passwordSchema = z
  .string()
  .min(10)
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/\d/, 'Password must contain a number.');

export const passwordLoginSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  password: z.string().min(1).max(128),
});
