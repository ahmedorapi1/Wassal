import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaClient } from '@wasel/database';
import type Redis from 'ioredis';

import { DATABASE, REDIS } from './infrastructure/tokens.js';

@Controller('health')
export class ReadinessController {
  public constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  public live() {
    return {
      service: 'skka-api',
      status: 'ok',
      check: 'liveness',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  public async ready() {
    try {
      const [, redis] = await Promise.all([
        this.database.$queryRaw`SELECT 1`,
        this.redis.ping(),
      ]);
      if (redis !== 'PONG') throw new Error('Redis readiness failed.');
      return {
        service: 'skka-api',
        status: 'ok',
        check: 'readiness',
        dependencies: { database: 'ok', redis: 'ok' },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        service: 'skka-api',
        status: 'unavailable',
        check: 'readiness',
      });
    }
  }
}
