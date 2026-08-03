import { z } from 'zod';

export const phaseThreePaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const courierAvailableOrdersQuerySchema =
  phaseThreePaginationSchema.extend({
    cursor: z.string().uuid().optional(),
  });

export const versionedOrderCommandSchema = z.object({
  version: z.number().int().positive(),
});

export const courierCancellationSchema = versionedOrderCommandSchema.extend({
  reason: z.string().trim().min(3).max(500),
});

export const financialSettingsUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    defaultCommissionBasisPoints: z.number().int().min(0).max(10_000),
    settlementCycle: z.literal('WEEKLY').default('WEEKLY'),
    gracePeriodDays: z.number().int().min(0).max(60),
    operationsTimezone: z.literal('Africa/Cairo').default('Africa/Cairo'),
    effectiveFrom: z.string().datetime().optional(),
  })
  .strict();

export const settlementCloseSchema = z.object({
  version: z.number().int().positive(),
});

export const externalPaymentSchema = z
  .object({
    amountMinor: z.number().int().positive(),
    currency: z.literal('EGP').default('EGP'),
    paidAt: z.string().datetime(),
    method: z.enum([
      'CASH',
      'BANK_TRANSFER',
      'MOBILE_WALLET_EXTERNAL',
      'OTHER',
    ]),
    externalReference: z.string().trim().max(160).optional(),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const courierAdjustmentSchema = z
  .object({
    type: z.enum([
      'ADJUSTMENT_DEBIT',
      'ADJUSTMENT_CREDIT',
      'WAIVER',
      'REVERSAL',
    ]),
    amountMinor: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
    settlementPeriodId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    reversesEntryId: z.string().uuid().optional(),
  })
  .superRefine((input, context) => {
    if (input.type === 'REVERSAL' && !input.reversesEntryId) {
      context.addIssue({
        code: 'custom',
        path: ['reversesEntryId'],
        message: 'A reversal must identify the original ledger entry.',
      });
    }
    if (input.type !== 'REVERSAL' && input.reversesEntryId) {
      context.addIssue({
        code: 'custom',
        path: ['reversesEntryId'],
        message: 'Only a reversal may identify an original ledger entry.',
      });
    }
  });

export const adminCourierAccountsQuerySchema =
  phaseThreePaginationSchema.extend({
    courierId: z.string().uuid().optional(),
    city: z.string().trim().max(120).optional(),
    serviceZoneId: z.string().uuid().optional(),
    settlementStatus: z
      .enum([
        'OPEN',
        'CLOSED',
        'NOT_DUE',
        'DUE_SOON',
        'PARTIALLY_PAID',
        'PAID',
        'OVERDUE',
        'WAIVED',
        'ADJUSTED',
      ])
      .optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    overdueOnly: z.coerce.boolean().optional(),
    paidOnly: z.coerce.boolean().optional(),
    remainingOnly: z.coerce.boolean().optional(),
  });
