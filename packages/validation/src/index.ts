import { z } from 'zod';

export function normalizeEgyptianPhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  if (/^01(0|1|2|5)\d{8}$/.test(compact)) return `+20${compact.slice(1)}`;
  if (/^201(0|1|2|5)\d{8}$/.test(compact)) return `+${compact}`;
  if (/^00201(0|1|2|5)\d{8}$/.test(compact)) return `+${compact.slice(2)}`;
  return compact;
}

export const egyptianPhoneSchema = z
  .string()
  .transform(normalizeEgyptianPhone)
  .pipe(
    z
      .string()
      .regex(/^\+20(10|11|12|15)\d{8}$/, 'Use a valid Egyptian mobile number.'),
  );

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const otpCodeSchema = z.string().regex(/^\d{6}$/);
export const idempotencyKeySchema = z.string().trim().min(16).max(128);

export const requestOtpSchema = z.object({
  phone: egyptianPhoneSchema,
});

export const verifyOtpSchema = z.object({
  challengeId: z.string().uuid(),
  code: otpCodeSchema,
});

export const merchantRoleSchema = z.enum([
  'merchant_owner',
  'merchant_manager',
  'merchant_staff',
]);

export const workingHoursSchema = z.record(
  z.string(),
  z
    .object({
      open: z.string().regex(/^\d{2}:\d{2}$/),
      close: z.string().regex(/^\d{2}:\d{2}$/),
      closed: z.boolean().default(false),
    })
    .nullable(),
);

export const coordinatesInputSchema = z.object({
  latitude: z.number().min(22).max(31.7),
  longitude: z.number().min(24.6).max(36.9),
});

export { z };

export type Coordinates = z.infer<typeof coordinatesSchema>;
