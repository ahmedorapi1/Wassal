import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { parseEnvironment, serverEnvironmentSchema } from '@wasel/config';
import { createLogger } from '@wasel/observability';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './infrastructure/http-exception.filter.js';
import { NestPinoLogger } from './infrastructure/nest-pino.logger.js';
import { RealtimeService } from './realtime/realtime.service.js';

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(serverEnvironmentSchema, process.env);
  const logger = createLogger('skka-api', { level: environment.LOG_LEVEL });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestPinoLogger(logger),
  });

  app.setGlobalPrefix('api/v1');
  if (environment.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '64kb' });
  app.use(helmet());
  const corsOrigins = environment.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin:
      environment.NODE_ENV === 'production'
        ? corsOrigins.length > 0
          ? corsOrigins
          : false
        : true,
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.get(RealtimeService).attach(app.getHttpServer());

  await app.listen(environment.API_PORT, '0.0.0.0');
  logger.info({ port: environment.API_PORT }, 'SKKA API is listening');
}

void bootstrap();
