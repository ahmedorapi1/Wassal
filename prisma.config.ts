import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: 'infrastructure/database/prisma/migrations',
    seed: 'node --import tsx infrastructure/database/prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
