export const config = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'incident_hub',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: parseInt(process.env.DB_POOL_MAX || '5', 10),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  consumer: {
    group: process.env.CONSUMER_GROUP || 'runbook-workers',
    name: process.env.CONSUMER_NAME || `worker-${process.pid}`,
    batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
    blockTimeout: parseInt(process.env.BLOCK_TIMEOUT || '5000', 10),
  },
  execution: {
    watchdogTimeout: parseInt(process.env.WATCHDOG_TIMEOUT || '30000', 10),
    maxRetryDelay: parseInt(process.env.MAX_RETRY_DELAY || '8000', 10),
    maxOutputLength: 10000,
  },
};
