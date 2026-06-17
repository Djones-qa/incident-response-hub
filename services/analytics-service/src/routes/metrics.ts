import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db.js';
import { redis } from '../redis.js';
import { createValidationError, createServiceUnavailableError } from '@incident-hub/shared-utils';

const router = Router();

const CACHE_TTL_SECONDS = 600;

interface MttrResponse {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// --- GET /metrics/mttr ---

router.get('/metrics/mttr', async (_req: Request, res: Response) => {
  const CACHE_KEY = 'cache:mttr';

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const parsed: MttrResponse = JSON.parse(cached);
      res.status(200).json(parsed);
      return;
    }
  } catch {
    // If Redis is unavailable, continue to compute from DB
  }

  let client;
  try {
    client = await pool.connect();
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  try {
    const result = await client.query<{ severity: string; avg_minutes: string }>(
      `SELECT severity,
              COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - declared_at)) / 60), 0) AS avg_minutes
       FROM incidents
       WHERE status IN ('resolved', 'closed')
         AND resolved_at IS NOT NULL
       GROUP BY severity`,
    );

    const mttr: MttrResponse = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const row of result.rows) {
      const severity = row.severity as keyof MttrResponse;
      if (severity in mttr) {
        const value = parseFloat(row.avg_minutes);
        mttr[severity] = Math.max(0, value);
      }
    }

    try {
      await redis.set(CACHE_KEY, JSON.stringify(mttr), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal
    }

    res.status(200).json(mttr);
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
  } finally {
    client.release();
  }
});

// --- GET /metrics/frequency ---

type FrequencyInterval = 'daily' | 'weekly' | 'monthly';

interface FrequencyBucket {
  bucket: string;
  count: number;
}

function hashParams(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

function validateTimeRange(
  startDate: string | undefined,
  endDate: string | undefined,
): { start: Date; end: Date } | { error: string } {
  if (!startDate || !endDate) {
    return { error: 'startDate and endDate query parameters are required' };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { error: 'startDate and endDate must be valid ISO date strings' };
  }

  if (end <= start) {
    return { error: 'endDate must be after startDate' };
  }

  const diffMs = end.getTime() - start.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > 365) {
    return { error: 'Time range must not exceed 365 days' };
  }

  return { start, end };
}

function generateDailyBuckets(start: Date, end: Date): string[] {
  const buckets: string[] = [];
  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setUTCHours(0, 0, 0, 0);

  while (current <= endDay) {
    buckets.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return buckets;
}

function generateWeeklyBuckets(start: Date, end: Date): string[] {
  const buckets: string[] = [];
  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);
  // Align to Monday (start of ISO week)
  const dayOfWeek = current.getUTCDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  current.setUTCDate(current.getUTCDate() + diff);

  while (current <= end) {
    buckets.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 7);
  }
  return buckets;
}

function generateMonthlyBuckets(start: Date, end: Date): string[] {
  const buckets: string[] = [];
  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);
  current.setUTCDate(1);

  while (current <= end) {
    buckets.push(current.toISOString().split('T')[0]);
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return buckets;
}

router.get('/metrics/frequency', async (req: Request, res: Response) => {
  const { startDate, endDate, interval } = req.query as {
    startDate?: string;
    endDate?: string;
    interval?: string;
  };

  // Validate interval
  const validIntervals: FrequencyInterval[] = ['daily', 'weekly', 'monthly'];
  if (!interval || !validIntervals.includes(interval as FrequencyInterval)) {
    const error = createValidationError(
      'interval query parameter is required and must be one of: daily, weekly, monthly',
    );
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  // Validate time range
  const rangeResult = validateTimeRange(startDate, endDate);
  if ('error' in rangeResult) {
    const error = createValidationError(rangeResult.error);
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  const { start, end } = rangeResult;
  const cacheKey = `cache:frequency:${hashParams({ startDate: startDate!, endDate: endDate!, interval })}`;

  // Check cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      res.status(200).json(JSON.parse(cached));
      return;
    }
  } catch {
    // Cache read failure is non-fatal
  }

  let client;
  try {
    client = await pool.connect();
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  try {
    let truncExpr: string;
    if (interval === 'daily') {
      truncExpr = "date_trunc('day', declared_at)";
    } else if (interval === 'weekly') {
      truncExpr = "date_trunc('week', declared_at)";
    } else {
      truncExpr = "date_trunc('month', declared_at)";
    }

    const result = await client.query<{ bucket: string; count: string }>(
      `SELECT ${truncExpr} AS bucket, COUNT(*)::text AS count
       FROM incidents
       WHERE declared_at >= $1 AND declared_at <= $2
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [start.toISOString(), end.toISOString()],
    );

    // Build a map of counts from the query
    const countMap = new Map<string, number>();
    for (const row of result.rows) {
      const bucketDate = new Date(row.bucket).toISOString().split('T')[0];
      countMap.set(bucketDate, parseInt(row.count, 10));
    }

    // Generate contiguous buckets with zero-fill
    let allBuckets: string[];
    if (interval === 'daily') {
      allBuckets = generateDailyBuckets(start, end);
    } else if (interval === 'weekly') {
      allBuckets = generateWeeklyBuckets(start, end);
    } else {
      allBuckets = generateMonthlyBuckets(start, end);
    }

    const response: FrequencyBucket[] = allBuckets.map((bucket) => ({
      bucket,
      count: countMap.get(bucket) || 0,
    }));

    // Cache result
    try {
      await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal
    }

    res.status(200).json(response);
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
  } finally {
    client.release();
  }
});

// --- GET /metrics/trends ---

interface TrendWeek {
  week: string;
  year: number;
  weekNumber: number;
  count: number;
  percentageChange: number | null;
}

function getISOWeekNumber(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function getMondayOfISOWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

router.get('/metrics/trends', async (_req: Request, res: Response) => {
  const CACHE_KEY = 'cache:trends';

  // Check cache
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      res.status(200).json(JSON.parse(cached));
      return;
    }
  } catch {
    // Cache read failure is non-fatal
  }

  let client;
  try {
    client = await pool.connect();
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  try {
    // Get current date and find the last 4 complete weeks
    // A complete week is one that has ended (Sunday has passed)
    const now = new Date();
    const currentISOWeek = getISOWeekNumber(now);
    const currentWeekMonday = getMondayOfISOWeek(currentISOWeek.year, currentISOWeek.week);

    // We need 5 weeks total (4 complete weeks + 1 previous for first comparison)
    const weeks: { year: number; week: number; start: Date; end: Date }[] = [];
    for (let i = 5; i >= 1; i--) {
      const weekStart = new Date(currentWeekMonday);
      weekStart.setUTCDate(weekStart.getUTCDate() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const isoWeek = getISOWeekNumber(weekStart);
      weeks.push({ year: isoWeek.year, week: isoWeek.week, start: weekStart, end: weekEnd });
    }

    // Query incident counts for the 5-week span
    const overallStart = weeks[0].start;
    const overallEnd = weeks[weeks.length - 1].end;

    const result = await client.query<{ week_start: string; count: string }>(
      `SELECT date_trunc('week', declared_at) AS week_start, COUNT(*)::text AS count
       FROM incidents
       WHERE declared_at >= $1 AND declared_at < $2
       GROUP BY week_start
       ORDER BY week_start ASC`,
      [overallStart.toISOString(), overallEnd.toISOString()],
    );

    // Map counts to weeks
    const weekCounts = new Map<string, number>();
    for (const row of result.rows) {
      const weekStart = new Date(row.week_start).toISOString().split('T')[0];
      weekCounts.set(weekStart, parseInt(row.count, 10));
    }

    // Build response for last 4 complete weeks with trend percentages
    const response: TrendWeek[] = [];
    for (let i = 1; i < weeks.length; i++) {
      const currentWeek = weeks[i];
      const previousWeek = weeks[i - 1];

      const currentCount = weekCounts.get(currentWeek.start.toISOString().split('T')[0]) || 0;
      const previousCount = weekCounts.get(previousWeek.start.toISOString().split('T')[0]) || 0;

      let percentageChange: number | null;
      if (previousCount === 0) {
        percentageChange = null;
      } else {
        percentageChange = ((currentCount - previousCount) / previousCount) * 100;
      }

      response.push({
        week: currentWeek.start.toISOString().split('T')[0],
        year: currentWeek.year,
        weekNumber: currentWeek.week,
        count: currentCount,
        percentageChange,
      });
    }

    // Cache result
    try {
      await redis.set(CACHE_KEY, JSON.stringify(response), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal
    }

    res.status(200).json(response);
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
  } finally {
    client.release();
  }
});

// --- GET /metrics/severity-distribution ---

interface SeverityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

router.get('/metrics/severity-distribution', async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query as {
    startDate?: string;
    endDate?: string;
  };

  // Validate time range
  const rangeResult = validateTimeRange(startDate, endDate);
  if ('error' in rangeResult) {
    const error = createValidationError(rangeResult.error);
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  const { start, end } = rangeResult;
  const cacheKey = `cache:severity-distribution:${hashParams({ startDate: startDate!, endDate: endDate! })}`;

  // Check cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      res.status(200).json(JSON.parse(cached));
      return;
    }
  } catch {
    // Cache read failure is non-fatal
  }

  let client;
  try {
    client = await pool.connect();
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
    return;
  }

  try {
    const result = await client.query<{ severity: string; count: string }>(
      `SELECT severity, COUNT(*)::text AS count
       FROM incidents
       WHERE declared_at >= $1 AND declared_at <= $2
       GROUP BY severity`,
      [start.toISOString(), end.toISOString()],
    );

    const distribution: SeverityDistribution = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const row of result.rows) {
      const severity = row.severity as keyof SeverityDistribution;
      if (severity in distribution) {
        distribution[severity] = parseInt(row.count, 10);
      }
    }

    // Cache result
    try {
      await redis.set(cacheKey, JSON.stringify(distribution), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal
    }

    res.status(200).json(distribution);
  } catch {
    const error = createServiceUnavailableError(
      'Database is temporarily unavailable. Metrics cannot be computed.',
    );
    res.status(error.statusCode).json({ error: error.error });
  } finally {
    client.release();
  }
});

export { router as metricsRouter };
