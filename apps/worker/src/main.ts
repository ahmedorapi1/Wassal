import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { parseEnvironment, workerEnvironmentSchema } from '@wasel/config';
import { createDatabaseClient } from '@wasel/database';
import { createLogger } from '@wasel/observability';

import {
  closeEligibleSettlements,
  markOverdueSettlements,
} from './settlement-jobs.js';
import {
  completeDeliveredOrders,
  createOperationalReminders,
  deleteExpiredReadNotifications,
} from './phase-four-jobs.js';
import { expireCourierAcceptanceWindows } from './order-acceptance-timeout.js';

const environment = parseEnvironment(workerEnvironmentSchema, process.env);
const logger = createLogger('wasel-worker', { level: environment.LOG_LEVEL });
const connection = new IORedis(environment.REDIS_URL, {
  maxRetriesPerRequest: null,
});
const foundationQueue = new Queue('wasel-foundation', { connection });
const financeQueue = new Queue('wasel-finance', { connection });
const database = createDatabaseClient(environment.DATABASE_URL);
const financeWorker = new Worker(
  financeQueue.name,
  async (job) => {
    if (job.name === 'close-settlements') {
      const count = await closeEligibleSettlements(database);
      logger.info({ count }, 'Closed eligible weekly settlement periods');
      return { count };
    }
    if (job.name === 'mark-overdue-settlements') {
      const count = await markOverdueSettlements(database);
      logger.info({ count }, 'Updated overdue settlement periods');
      return { count };
    }
    if (job.name === 'complete-delivered-orders') {
      const count = await completeDeliveredOrders(database);
      logger.info(
        { count },
        'Completed delivered orders after dispute deadline',
      );
      return { count };
    }
    if (job.name === 'operational-reminders') {
      const count = await createOperationalReminders(database);
      logger.info({ count }, 'Created Phase 4 in-app reminders');
      return { count };
    }
    if (job.name === 'notification-retention') {
      const count = await deleteExpiredReadNotifications(database);
      logger.info({ count }, 'Removed expired read notifications');
      return { count };
    }
    if (job.name === 'expire-courier-acceptance-windows') {
      const count = await expireCourierAcceptanceWindows(
        database,
        new Date(),
        async (room, type, payload) => {
          await connection.publish(
            'wasel:realtime:v1',
            JSON.stringify({ room, type, payload }),
          );
        },
      );
      logger.info({ count }, 'Expired courier acceptance windows');
      return { count };
    }
    throw new Error(`Unsupported finance job: ${job.name}`);
  },
  { connection, concurrency: 1 },
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker is shutting down');
  await Promise.all([
    financeWorker.close(),
    financeQueue.close(),
    foundationQueue.close(),
    database.$disconnect(),
  ]);
  await connection.quit();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

async function bootstrap(): Promise<void> {
  await Promise.all([
    connection.ping(),
    foundationQueue.waitUntilReady(),
    financeQueue.waitUntilReady(),
    financeWorker.waitUntilReady(),
  ]);
  await Promise.all([
    financeQueue.add(
      'close-settlements',
      {},
      {
        jobId: 'phase3-close-settlements',
        repeat: { every: 60 * 60 * 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    ),
    financeQueue.add(
      'complete-delivered-orders',
      {},
      {
        jobId: 'phase4-complete-delivered-orders',
        repeat: { every: 60 * 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    ),
    financeQueue.add(
      'operational-reminders',
      {},
      {
        jobId: 'phase4-operational-reminders',
        repeat: { every: 30 * 60 * 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    ),
    financeQueue.add(
      'notification-retention',
      {},
      {
        jobId: 'phase4-notification-retention',
        repeat: { every: 24 * 60 * 60 * 1_000 },
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    ),
    financeQueue.add(
      'expire-courier-acceptance-windows',
      {},
      {
        jobId: 'order-expire-courier-acceptance-windows',
        repeat: { every: 15 * 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    ),
    financeQueue.add(
      'mark-overdue-settlements',
      {},
      {
        jobId: 'phase3-mark-overdue-settlements',
        repeat: { every: 60 * 60 * 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    ),
  ]);
  logger.info(
    {
      queues: [foundationQueue.name, financeQueue.name],
      redisConnected: true,
    },
    'SKKA worker and Phase 4 operational jobs are ready',
  );
}

void bootstrap().catch(async (error: unknown) => {
  logger.fatal({ err: error }, 'Worker failed to connect to Redis');
  await Promise.all([
    financeWorker.close(),
    financeQueue.close(),
    foundationQueue.close(),
    database.$disconnect(),
  ]);
  connection.disconnect();
  process.exitCode = 1;
});
