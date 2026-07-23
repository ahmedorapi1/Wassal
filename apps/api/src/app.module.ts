import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { parseEnvironment, serverEnvironmentSchema } from '@wasel/config';
import type { PrismaClient } from '@wasel/database';
import { createDatabaseClient } from '@wasel/database';
import {
  LocalObjectStorageProvider,
  MockOtpProvider,
  type OtpProvider,
} from '@wasel/providers';
import Redis from 'ioredis';

import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { AppController } from './app.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { RolesGuard } from './auth/roles.guard.js';
import { CourierController } from './courier/courier.controller.js';
import { CourierService } from './courier/courier.service.js';
import {
  DATABASE,
  ENVIRONMENT,
  OBJECT_STORAGE,
  OTP_PROVIDER,
  REDIS,
} from './infrastructure/tokens.js';
import { MerchantController } from './merchant/merchant.controller.js';
import { MerchantService } from './merchant/merchant.service.js';

const environment = parseEnvironment(serverEnvironmentSchema, process.env);

@Injectable()
class InfrastructureLifecycle implements OnModuleDestroy {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  public async onModuleDestroy(): Promise<void> {
    await Promise.all([this.database.$disconnect(), this.redis.quit()]);
  }
}

@Module({
  controllers: [
    AppController,
    AuthController,
    MerchantController,
    CourierController,
    AdminController,
  ],
  providers: [
    { provide: ENVIRONMENT, useValue: environment },
    {
      provide: DATABASE,
      useFactory: () => createDatabaseClient(environment.DATABASE_URL),
    },
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(environment.REDIS_URL, {
          enableReadyCheck: true,
          maxRetriesPerRequest: 2,
        }),
    },
    {
      provide: OTP_PROVIDER,
      useFactory: (): OtpProvider => {
        if (environment.NODE_ENV !== 'production') {
          return new MockOtpProvider(environment.OTP_MOCK_CODE);
        }
        return {
          request: async () => {
            throw new Error('A production OTP provider is not configured.');
          },
        };
      },
    },
    {
      provide: OBJECT_STORAGE,
      useFactory: () =>
        new LocalObjectStorageProvider(environment.STORAGE_LOCAL_DIR),
    },
    AuthService,
    AuthGuard,
    RolesGuard,
    MerchantService,
    CourierService,
    AdminService,
    InfrastructureLifecycle,
  ],
})
export class AppModule {}
