import express from 'express';
import { config } from './config.js';
import { pool, checkDbConnection } from './db.js';
import { redis, checkRedisConnection } from './redis.js';
import { metricsRouter } from './routes/metrics.js';

const app = express();

app.use(express.json());
app.use(metricsRouter);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', async (_req, res) => {
  const timeout = config.readinessTimeout;
  const checks = {
    database: false,
    redis: false,
  };

  try {
    const results = await Promise.race([
      Promise.all([checkDbConnection(), checkRedisConnection()]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Readiness check timed out')), timeout)
      ),
    ]);

    checks.database = results[0];
    checks.redis = results[1];
  } catch {
    // Timeout or error — checks remain false
  }

  const allReady = checks.database && checks.redis;

  if (allReady) {
    res.status(200).json({ status: 'ready', checks });
  } else {
    const unavailable: string[] = [];
    if (!checks.database) unavailable.push('database');
    if (!checks.redis) unavailable.push('redis');
    res.status(503).json({
      status: 'unavailable',
      checks,
      message: `Dependencies unavailable: ${unavailable.join(', ')}`,
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
    console.log(`analytics-service listening on port ${config.port}`);
  });
}

start();

export { app, pool, redis };
