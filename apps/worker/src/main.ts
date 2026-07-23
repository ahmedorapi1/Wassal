import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { parseEnvironment, workerEnvironmentSchema } from '@wasel/config';
import { createLogger } from '@wasel/observability';

const environment = parseEnvironment(workerEnvironmentSchema, process.env);
const logger = createLogger('wasel-worker', { level: environment.LOG_LEVEL });
const connection = new IORedis(environment.REDIS_URL, {
  maxRetriesPerRequest: null,
});
const foundationQueue = new Queue('wasel-foundation', { connection });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker is shutting down');
  await foundationQueue.close();
  await connection.quit();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

async function bootstrap(): Promise<void> {
  await Promise.all([connection.ping(), foundationQueue.waitUntilReady()]);
  logger.info(
    { queue: foundationQueue.name, redisConnected: true },
    'Wasel worker foundation is ready',
  );
}

void bootstrap().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'Worker failed to connect to Redis');
  await foundationQueue.close();
  connection.disconnect();
  process.exitCode = 1;
});
