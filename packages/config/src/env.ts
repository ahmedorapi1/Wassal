import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const sharedServerEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default('development'),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url().startsWith('redis://'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export const serverEnvironmentSchema = sharedServerEnvironmentSchema.extend({
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
  CORS_ORIGINS: z.string().default(''),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1_024).default(5_242_880),
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
