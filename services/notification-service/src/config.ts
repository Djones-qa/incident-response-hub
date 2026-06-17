export const config = {
  port: parseInt(process.env.PORT || '4001', 10),
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  readinessTimeout: parseInt(process.env.READINESS_TIMEOUT || '5000', 10),
};
