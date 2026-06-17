import { pool } from './db.js';
import { config } from './config.js';

const WATCHDOG_INTERVAL_MS = 10_000;

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Checks for stalled executions that have not reported progress within the
 * configured watchdog timeout (default 30 seconds). Marks them as "failed".
 */
async function checkStalledExecutions(): Promise<void> {
  try {
    const timeoutMs = config.execution.watchdogTimeout;
    const result = await pool.query(
      `UPDATE runbook_executions
       SET status = 'failed',
           completed_at = NOW(),
           error = 'Execution interrupted: no progress within 30 seconds'
       WHERE status = 'running'
         AND last_progress_at < NOW() - INTERVAL '1 millisecond' * $1
       RETURNING id`,
      [timeoutMs]
    );

    if (result.rowCount && result.rowCount > 0) {
      console.warn(
        `Watchdog: marked ${result.rowCount} stalled execution(s) as failed:`,
        result.rows.map((r) => r.id)
      );
    }
  } catch (err) {
    console.error('Watchdog: error checking stalled executions:', err);
  }
}

/**
 * Starts the execution watchdog timer. Runs every 10 seconds to detect
 * executions that have not made progress within the configured timeout.
 */
export function startWatchdog(): void {
  if (watchdogTimer) {
    return; // Already running
  }

  watchdogTimer = setInterval(checkStalledExecutions, WATCHDOG_INTERVAL_MS);
  console.log(
    `Watchdog started (interval: ${WATCHDOG_INTERVAL_MS}ms, timeout: ${config.execution.watchdogTimeout}ms)`
  );
}

/**
 * Stops the execution watchdog timer.
 */
export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    console.log('Watchdog stopped');
  }
}
