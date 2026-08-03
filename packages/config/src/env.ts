import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const sharedServerEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default('development'),
  APP_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url().startsWith('redis://'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export const serverEnvironmentSchema = sharedServerEnvironmentSchema
  .extend({
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    OTP_MOCK_CODE: z.string().regex(/^\d{6}$/),
    OTP_PEPPER: z.string().min(32),
    ACCESS_TOKEN_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).default(60),
    STORAGE_LOCAL_DIR: z.string().min(1).default('.data/uploads'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_PREFIX: z.string().default(''),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1_024).default(5_242_880),
    QUOTE_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    ORDER_MAX_WEIGHT_GRAMS: z.coerce.number().int().min(1_000).default(25_000),
    ORDER_MAX_DECLARED_VALUE_MINOR: z.coerce
      .number()
      .int()
      .min(0)
      .default(500_000),
    QUOTE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    ORDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    MERCHANT_PILOT_REGISTRATION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((environment, context) => {
    if (environment.APP_ENV === 'production') {
      if (environment.NODE_ENV !== 'production') {
        context.addIssue({
          code: 'custom',
          path: ['NODE_ENV'],
          message: 'NODE_ENV must be production when APP_ENV is production.',
        });
      }
      if (environment.STORAGE_DRIVER !== 's3') {
        context.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'Production requires private S3-compatible object storage.',
        });
      }
      if (!environment.CORS_ORIGINS.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Production requires an explicit CORS allowlist.',
        });
      }
      if (
        environment.CORS_ORIGINS.split(',').some(
          (origin) => origin.trim() === '*',
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Wildcard production CORS origins are prohibited.',
        });
      }
    }
    if (
      environment.STORAGE_DRIVER === 's3' &&
      [
        environment.S3_REGION,
        environment.S3_BUCKET,
        environment.S3_ACCESS_KEY_ID,
        environment.S3_SECRET_ACCESS_KEY,
      ].some((value) => !value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'S3 region, bucket, access key, and secret key are required.',
      });
    }
  });

export const workerEnvironmentSchema = sharedServerEnvironmentSchema;

export const publicWebEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export const publicMobileEnvironmentSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function parseEnvironment<TSchema extends z.ZodType>(
  schema: TSchema,
  environment: Record<string, unknown>,
): z.infer<TSchema> {
  const result = schema.safeParse(environment);

  if (!result.success) {
    const details = z.prettifyError(result.error);
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
