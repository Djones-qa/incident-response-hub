import { exec } from 'child_process';
import type { RunbookStep, StepResult } from '@incident-hub/shared-types';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';

const PROGRESS_STREAM = 'stream:execution-progress';

export interface ExecutionContext {
  executionId: string;
  runbookId: string;
  incidentId: string;
}

/**
 * Executes a single automated step command with timeout enforcement.
 * Returns the command output or throws on timeout/failure.
 */
function executeCommand(command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error('STEP_TIMEOUT'));
        } else {
          reject(new Error(stderr || error.message));
        }
      } else {
        resolve(stdout || stderr || '');
      }
    });

    // Safety fallback: if child_process timeout doesn't fire, use Promise.race
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('STEP_TIMEOUT'));
    }, timeoutMs + 500);

    child.on('close', () => clearTimeout(timer));
  });
}

/**
 * Wraps step execution with a timeout using Promise.race.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('STEP_TIMEOUT')), timeoutMs)
    ),
  ]);
}

/**
 * Truncates output to the configured max length (10,000 chars).
 */
function truncateOutput(output: string): string {
  if (output.length <= config.execution.maxOutputLength) {
    return output;
  }
  return output.substring(0, config.execution.maxOutputLength);
}

/**
 * Computes exponential backoff delay: min(2^(attempt-1), maxDelay) seconds.
 */
function getRetryDelay(attempt: number): number {
  const delayMs = Math.min(
    Math.pow(2, attempt - 1) * 1000,
    config.execution.maxRetryDelay
  );
  return delayMs;
}

/**
 * Executes a single step with retries and records the result.
 */
async function executeStepWithRetries(
  step: RunbookStep,
  context: ExecutionContext
): Promise<StepResult> {
  const timeoutMs = step.timeout * 1000;
  let lastError = '';
  let retryCount = 0;

  for (let attempt = 0; attempt <= step.retries; attempt++) {
    const startTime = Date.now();

    try {
      let output: string;

      if (step.command) {
        output = await withTimeout(
          executeCommand(step.command, timeoutMs),
          timeoutMs
        );
      } else {
        // Automated step without a command — simulate success
        output = `Step "${step.name}" executed successfully (no command specified)`;
      }

      const durationMs = Date.now() - startTime;

      return {
        stepOrder: step.order,
        status: 'success',
        output: truncateOutput(output),
        durationMs,
        retryCount,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (errorMessage === 'STEP_TIMEOUT') {
        // Timeout is treated as step failure — no more retries on timeout
        return {
          stepOrder: step.order,
          status: 'timed_out',
          output: truncateOutput(`Step timed out after ${step.timeout}s`),
          durationMs,
          retryCount,
        };
      }

      lastError = errorMessage;
      retryCount = attempt + 1;

      // If we have more retries, wait with exponential backoff
      if (attempt < step.retries) {
        const delay = getRetryDelay(attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  return {
    stepOrder: step.order,
    status: 'failed',
    output: truncateOutput(lastError),
    durationMs: 0,
    retryCount,
  };
}

/**
 * Publishes step progress to the execution-progress Redis stream.
 */
async function publishProgress(
  context: ExecutionContext,
  result: StepResult
): Promise<void> {
  await redis.xadd(
    PROGRESS_STREAM,
    '*',
    'executionId', context.executionId,
    'stepOrder', String(result.stepOrder),
    'status', result.status,
    'output', result.output,
    'durationMs', String(result.durationMs)
  );
}

/**
 * Updates the execution record in PostgreSQL with current step results.
 */
async function updateExecutionStepResults(
  executionId: string,
  stepResults: StepResult[]
): Promise<void> {
  await pool.query(
    `UPDATE runbook_executions
     SET step_results = $1::jsonb,
         last_progress_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(stepResults), executionId]
  );
}

/**
 * Sets the execution status to "running" and records startedAt timestamp.
 */
async function markExecutionRunning(executionId: string): Promise<void> {
  await pool.query(
    `UPDATE runbook_executions
     SET status = 'running',
         started_at = NOW()
     WHERE id = $1`,
    [executionId]
  );
}

/**
 * Fetches runbook steps from the database for a given runbook ID.
 */
async function fetchRunbookSteps(runbookId: string): Promise<RunbookStep[]> {
  const result = await pool.query(
    `SELECT steps FROM runbooks WHERE id = $1`,
    [runbookId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Runbook not found: ${runbookId}`);
  }

  const steps: RunbookStep[] = result.rows[0].steps;
  // Sort by order field ascending
  return steps.sort((a, b) => a.order - b.order);
}

/**
 * Fetches rollback steps from the database for a given runbook ID.
 * Returns them sorted in reverse order (descending) for execution.
 */
async function fetchRollbackSteps(runbookId: string): Promise<RunbookStep[]> {
  const result = await pool.query(
    `SELECT rollback_steps FROM runbooks WHERE id = $1`,
    [runbookId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Runbook not found: ${runbookId}`);
  }

  const rollbackSteps: RunbookStep[] = result.rows[0].rollback_steps || [];
  // Sort by order field descending (reverse order execution)
  return rollbackSteps.sort((a, b) => b.order - a.order);
}

/**
 * Executes rollback steps in reverse order. Continues executing remaining
 * rollback steps even if one fails. Returns whether all rollback steps succeeded.
 */
async function executeRollback(
  context: ExecutionContext,
  stepResults: StepResult[]
): Promise<{ success: boolean; rollbackResults: StepResult[] }> {
  const rollbackSteps = await fetchRollbackSteps(context.runbookId);
  const rollbackResults: StepResult[] = [];
  let allSucceeded = true;

  for (const step of rollbackSteps) {
    // Skip manual rollback steps
    if (step.type === 'manual') {
      const skippedResult: StepResult = {
        stepOrder: step.order,
        status: 'skipped',
        output: `Manual rollback step "${step.name}" skipped`,
        durationMs: 0,
        retryCount: 0,
      };
      rollbackResults.push(skippedResult);
      await publishProgress(context, skippedResult);
      continue;
    }

    // Execute the rollback step (with retries as configured on the step)
    const result = await executeStepWithRetries(step, context);
    rollbackResults.push(result);
    await publishProgress(context, result);

    if (result.status === 'failed' || result.status === 'timed_out') {
      allSucceeded = false;
      // Continue executing remaining rollback steps — don't halt
    }
  }

  return { success: allSucceeded, rollbackResults };
}

/**
 * Main executor: runs all automated steps sequentially, skipping manual steps.
 * Records results and publishes progress after each step.
 */
export async function executeRunbook(context: ExecutionContext): Promise<void> {
  const { executionId, runbookId } = context;

  // Fetch steps from database
  const steps = await fetchRunbookSteps(runbookId);

  // Mark execution as running
  await markExecutionRunning(executionId);

  const stepResults: StepResult[] = [];

  for (const step of steps) {
    // Skip manual steps
    if (step.type === 'manual') {
      const skippedResult: StepResult = {
        stepOrder: step.order,
        status: 'skipped',
        output: `Manual step "${step.name}" skipped`,
        durationMs: 0,
        retryCount: 0,
      };
      stepResults.push(skippedResult);
      await updateExecutionStepResults(executionId, stepResults);
      await publishProgress(context, skippedResult);
      continue;
    }

    // Execute automated step
    const result = await executeStepWithRetries(step, context);
    stepResults.push(result);

    // Persist results and publish progress
    await updateExecutionStepResults(executionId, stepResults);
    await publishProgress(context, result);

    // If the step failed or timed out, execute rollback
    if (result.status === 'failed' || result.status === 'timed_out') {
      const errorMessage = `Step ${step.order} (${step.name}) ${result.status}: ${result.output}`;

      // Execute rollback steps in reverse order
      const { success: rollbackSucceeded, rollbackResults } = await executeRollback(
        context,
        stepResults
      );

      // Append rollback results to step_results
      const allResults = [...stepResults, ...rollbackResults];

      // Determine final status based on rollback outcome
      const finalStatus = rollbackSucceeded ? 'rolled_back' : 'failed';

      await pool.query(
        `UPDATE runbook_executions
         SET status = $1,
             completed_at = NOW(),
             step_results = $2::jsonb,
             error = $3
         WHERE id = $4`,
        [finalStatus, JSON.stringify(allResults), errorMessage, executionId]
      );
      return;
    }
  }

  // All steps completed successfully
  await pool.query(
    `UPDATE runbook_executions
     SET status = 'completed',
         completed_at = NOW()
     WHERE id = $1`,
    [executionId]
  );
}
