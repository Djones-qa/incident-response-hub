import express from 'express';
import { config } from './config.js';
import { redis, checkRedisConnection } from './redis.js';
import { startTimerManager, stopTimerManager } from './escalation/timer-manager.js';
import { notificationRoutes } from './routes/notifications.js';
import { escalationPoliciesRouter } from './routes/escalation-policies.js';
import { startStreamConsumer } from './stream-consumer.js';

const app = express();

app.use(express.json());

// Register routes
app.use(notificationRoutes);
app.use('/escalation-policies', escalationPoliciesRouter);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', async (_req, res) => {
  const timeout = config.readinessTimeout;
  const checks = {
    redis: false,
  };

  try {
    const result = await Promise.race([
      checkRedisConnection(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Readiness check timed out')), timeout)
      ),
    ]);

    checks.redis = result;
  } catch {
    // Timeout or error — check remains false
  }

  if (checks.redis) {
    res.status(200).json({ status: 'ready', checks });
  } else {
    res.status(503).json({
      status: 'unavailable',
      checks,
      message: 'Dependencies unavailable: redis',
    });
  }
});

async function start(): Promise<void> {
  try {
    await redis.connect();
    console.log('Connected to Redis');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }

  app.listen(config.port, () => {
    console.log(`notification-service listening on port ${config.port}`);
  });

  // Start the stream consumer in the background
  startStreamConsumer().catch((err) => {
    console.error('Stream consumer error:', err);
  });

  // Start the escalation timer manager
  await startTimerManager();
}

async function shutdown(): Promise<void> {
  stopTimerManager();
  await redis.quit();
  console.log('notification-service shut down');
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

export { app, redis };
