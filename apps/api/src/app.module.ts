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
  DeterministicLocalMapsProvider,
  LocalObjectStorageProvider,
  MockOtpProvider,
  S3ObjectStorageProvider,
  type MapsProvider,
  type OtpProvider,
} from '@wasel/providers';
import Redis from 'ioredis';

import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { PhaseTwoAdminController } from './admin/phase-two-admin.controller.js';
import { PhaseTwoAdminService } from './admin/phase-two-admin.service.js';
import { AppController } from './app.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { PermissionsGuard } from './auth/permissions.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { CourierController } from './courier/courier.controller.js';
import { CourierService } from './courier/courier.service.js';
import { CourierOrdersController } from './courier-orders/courier-orders.controller.js';
import { CourierOrdersService } from './courier-orders/courier-orders.service.js';
import { CustomersController } from './customers/customers.controller.js';
import { CustomersService } from './customers/customers.service.js';
import { AdminFinanceController } from './finance/admin-finance.controller.js';
import { CourierFinanceController } from './finance/courier-finance.controller.js';
import { FinanceService } from './finance/finance.service.js';
import {
  DATABASE,
  ENVIRONMENT,
  MAPS_PROVIDER,
  OBJECT_STORAGE,
  OTP_PROVIDER,
  REDIS,
} from './infrastructure/tokens.js';
import { MerchantController } from './merchant/merchant.controller.js';
import { MerchantService } from './merchant/merchant.service.js';
import { LocationController } from './location/location.controller.js';
import { LocationService } from './location/location.service.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { DeliveryOperationsController } from './operations/delivery-operations.controller.js';
import { DeliveryOperationsService } from './operations/delivery-operations.service.js';
import { OperationalSettingsController } from './operations/operational-settings.controller.js';
import { OperationalSettingsService } from './operations/operational-settings.service.js';
import { OrderFinalizationService } from './orders/order-finalization.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { PaymentProofsController } from './payment-proofs/payment-proofs.controller.js';
import { PaymentProofsService } from './payment-proofs/payment-proofs.service.js';
import { RealtimeService } from './realtime/realtime.service.js';
import { ReadinessController } from './readiness.controller.js';

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
    LocationController,
    CustomersController,
    OrdersController,
    CourierController,
    CourierOrdersController,
    AdminController,
    PhaseTwoAdminController,
    AdminFinanceController,
    CourierFinanceController,
    NotificationsController,
    DeliveryOperationsController,
    OperationalSettingsController,
    PaymentProofsController,
    ReadinessController,
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
        environment.STORAGE_DRIVER === 's3'
          ? new S3ObjectStorageProvider({
              endpoint: environment.S3_ENDPOINT,
              region: environment.S3_REGION!,
              bucket: environment.S3_BUCKET!,
              accessKeyId: environment.S3_ACCESS_KEY_ID!,
              secretAccessKey: environment.S3_SECRET_ACCESS_KEY!,
              prefix: environment.S3_PREFIX,
              forcePathStyle: environment.S3_FORCE_PATH_STYLE,
            })
          : new LocalObjectStorageProvider(environment.STORAGE_LOCAL_DIR),
    },
    {
      provide: MAPS_PROVIDER,
      useFactory: (): MapsProvider => new DeterministicLocalMapsProvider(),
    },
    AuthService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    MerchantService,
    LocationService,
    CustomersService,
    OrdersService,
    CourierService,
    CourierOrdersService,
    AdminService,
    PhaseTwoAdminService,
    FinanceService,
    RealtimeService,
    NotificationsService,
    OrderFinalizationService,
    DeliveryOperationsService,
    OperationalSettingsService,
    PaymentProofsService,
    InfrastructureLifecycle,
  ],
})
export class AppModule {}
