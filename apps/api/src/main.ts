import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { parseEnvironment, serverEnvironmentSchema } from '@wasel/config';
import { createLogger } from '@wasel/observability';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './infrastructure/http-exception.filter.js';
import { NestPinoLogger } from './infrastructure/nest-pino.logger.js';

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(serverEnvironmentSchema, process.env);
  const logger = createLogger('wasel-api', { level: environment.LOG_LEVEL });
  const app = await NestFactory.create(AppModule, {
    logger: new NestPinoLogger(logger),
  });

  app.setGlobalPrefix('api/v1');
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

  await app.listen(environment.API_PORT, '0.0.0.0');
  logger.info({ port: environment.API_PORT }, 'Wasel API is listening');
}

void bootstrap();
