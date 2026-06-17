import { config } from './config.js';
import { redis, checkRedisConnection } from './redis.js';
import { pool, checkDbConnection } from './db.js';
import { ensureConsumerGroup, startConsumer, stopConsumer } from './consumer.js';
import { startWatchdog, stopWatchdog } from './watchdog.js';

async function start(): Promise<void> {
  try {
    // Connect to Redis
    await redis.connect();
    const redisOk = await checkRedisConnection();
    if (!redisOk) {
      throw new Error('Redis PING failed');
    }
    console.log('Connected to Redis');

    // Verify database connectivity
    const dbOk = await checkDbConnection();
    if (!dbOk) {
      throw new Error('Database connection check failed');
    }
    console.log('Connected to PostgreSQL');

    // Ensure consumer group exists
    await ensureConsumerGroup();

    // Start consuming messages
    startConsumer();

    // Start execution watchdog timer
    startWatchdog();

    console.log(`runbook-worker started (group: ${config.consumer.group}, consumer: ${config.consumer.name})`);
  } catch (err) {
    console.error('Failed to start runbook-worker:', err);
    process.exit(1);
  }
}

function shutdown(): void {
  console.log('Shutting down runbook-worker...');
  stopWatchdog();
  stopConsumer();
  redis.disconnect();
  pool.end().catch((err) => {
    console.error('Error closing database pool:', err);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

export { redis, pool };
