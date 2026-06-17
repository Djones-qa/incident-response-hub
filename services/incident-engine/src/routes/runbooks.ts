import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Runbook, RunbookStep, TriggerCondition } from '@incident-hub/shared-types';
import {
  createValidationError,
  createNotFoundError,
  createServiceUnavailableError,
} from '@incident-hub/shared-utils';
import { pool } from '../db.js';
import { redis } from '../redis.js';

const router = Router();

interface FieldError {
  field: string;
  message: string;
}

const VALID_STEP_TYPES = ['manual', 'automated'];
const VALID_OPERATORS = ['equals', 'contains', 'gt', 'lt'];

function validateTriggerConditions(conditions: unknown): FieldError[] {
  const errors: FieldError[] = [];

  if (!Array.isArray(conditions)) {
    errors.push({ field: 'triggerConditions', message: 'triggerConditions must be an array' });
    return errors;
  }

  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i] as Record<string, unknown>;

    if (!condition || typeof condition !== 'object') {
      errors.push({
        field: `triggerConditions[${i}]`,
        message: 'each trigger condition must be an object',
      });
      continue;
    }

    if (
      condition.field === undefined ||
      condition.field === null ||
      typeof condition.field !== 'string' ||
      condition.field.trim().length === 0
    ) {
      errors.push({
        field: `triggerConditions[${i}].field`,
        message: 'field is required and must be a non-empty string',
      });
    }

    if (
      condition.operator === undefined ||
      condition.operator === null ||
      typeof condition.operator !== 'string' ||
      !VALID_OPERATORS.includes(condition.operator)
    ) {
      errors.push({
        field: `triggerConditions[${i}].operator`,
        message: `operator must be one of: ${VALID_OPERATORS.join(', ')}`,
      });
    }

    if (
      condition.value === undefined ||
      condition.value === null ||
      typeof condition.value !== 'string'
    ) {
      errors.push({
        field: `triggerConditions[${i}].value`,
        message: 'value is required and must be a string',
      });
    }
  }

  return errors;
}

function validateSteps(steps: unknown, fieldName: string): FieldError[] {
  const errors: FieldError[] = [];

  if (!Array.isArray(steps)) {
    errors.push({ field: fieldName, message: `${fieldName} must be an array` });
    return errors;
  }

  if (steps.length === 0) {
    errors.push({ field: fieldName, message: `${fieldName} must contain at least one step` });
    return errors;
  }

  // Check for duplicate order values
  const orders = new Set<number>();
  const duplicateOrders: number[] = [];

  for (const step of steps) {
    const s = step as Record<string, unknown>;
    if (s && typeof s.order === 'number') {
      if (orders.has(s.order)) {
        duplicateOrders.push(s.order);
      }
      orders.add(s.order);
    }
  }

  if (duplicateOrders.length > 0) {
    errors.push({
      field: fieldName,
      message: `duplicate step order values found: ${[...new Set(duplicateOrders)].join(', ')}`,
    });
    return errors;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown>;

    if (!step || typeof step !== 'object') {
      errors.push({ field: `${fieldName}[${i}]`, message: 'each step must be an object' });
      continue;
    }

    // Validate order
    if (step.order === undefined || step.order === null) {
      errors.push({ field: `${fieldName}[${i}].order`, message: 'order is required' });
    } else if (typeof step.order !== 'number' || !Number.isInteger(step.order)) {
      errors.push({ field: `${fieldName}[${i}].order`, message: 'order must be an integer' });
    }

    // Validate name
    if (
      step.name === undefined ||
      step.name === null ||
      typeof step.name !== 'string' ||
      step.name.trim().length === 0
    ) {
      errors.push({
        field: `${fieldName}[${i}].name`,
        message: 'name is required and must be a non-empty string',
      });
    }

    // Validate type
    if (
      step.type === undefined ||
      step.type === null ||
      typeof step.type !== 'string' ||
      !VALID_STEP_TYPES.includes(step.type)
    ) {
      errors.push({
        field: `${fieldName}[${i}].type`,
        message: `type must be one of: ${VALID_STEP_TYPES.join(', ')}`,
      });
    }

    // Validate expectedOutcome
    if (
      step.expectedOutcome === undefined ||
      step.expectedOutcome === null ||
      typeof step.expectedOutcome !== 'string' ||
      step.expectedOutcome.trim().length === 0
    ) {
      errors.push({
        field: `${fieldName}[${i}].expectedOutcome`,
        message: 'expectedOutcome is required and must be a non-empty string',
      });
    }

    // Validate timeout (positive integer in seconds)
    if (step.timeout === undefined || step.timeout === null) {
      errors.push({ field: `${fieldName}[${i}].timeout`, message: 'timeout is required' });
    } else if (
      typeof step.timeout !== 'number' ||
      !Number.isInteger(step.timeout) ||
      step.timeout <= 0
    ) {
      errors.push({
        field: `${fieldName}[${i}].timeout`,
        message: 'timeout must be a positive integer (seconds)',
      });
    }

    // Validate retries (0-10)
    if (step.retries === undefined || step.retries === null) {
      errors.push({ field: `${fieldName}[${i}].retries`, message: 'retries is required' });
    } else if (
      typeof step.retries !== 'number' ||
      !Number.isInteger(step.retries) ||
      step.retries < 0 ||
      step.retries > 10
    ) {
      errors.push({
        field: `${fieldName}[${i}].retries`,
        message: 'retries must be an integer between 0 and 10',
      });
    }

    // Validate command for automated steps
    if (step.type === 'automated') {
      if (
        step.command === undefined ||
        step.command === null ||
        typeof step.command !== 'string' ||
        step.command.trim().length === 0
      ) {
        errors.push({
          field: `${fieldName}[${i}].command`,
          message: 'command is required for automated steps and must be a non-empty string',
        });
      }
    }
  }

  return errors;
}

function validateRunbookCreation(body: unknown): FieldError[] {
  const errors: FieldError[] = [];
  const request = body as Record<string, unknown>;

  // Validate name
  if (request.name === undefined || request.name === null) {
    errors.push({ field: 'name', message: 'name is required' });
  } else if (typeof request.name !== 'string' || request.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'name must be a non-empty string' });
  }

  // Validate description
  if (request.description === undefined || request.description === null) {
    errors.push({ field: 'description', message: 'description is required' });
  } else if (typeof request.description !== 'string') {
    errors.push({ field: 'description', message: 'description must be a string' });
  }

  // Validate triggerConditions
  if (request.triggerConditions === undefined || request.triggerConditions === null) {
    errors.push({ field: 'triggerConditions', message: 'triggerConditions is required' });
  } else {
    errors.push(...validateTriggerConditions(request.triggerConditions));
  }

  // Validate steps
  if (request.steps === undefined || request.steps === null) {
    errors.push({ field: 'steps', message: 'steps is required' });
  } else {
    errors.push(...validateSteps(request.steps, 'steps'));
  }

  // Validate rollbackSteps
  if (request.rollbackSteps === undefined || request.rollbackSteps === null) {
    errors.push({ field: 'rollbackSteps', message: 'rollbackSteps is required' });
  } else if (!Array.isArray(request.rollbackSteps)) {
    errors.push({ field: 'rollbackSteps', message: 'rollbackSteps must be an array' });
  } else if (request.rollbackSteps.length > 0) {
    errors.push(...validateSteps(request.rollbackSteps, 'rollbackSteps'));
  }

  return errors;
}

function mapRowToRunbook(row: Record<string, unknown>): Runbook {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    triggerConditions: row.trigger_conditions as TriggerCondition[],
    steps: row.steps as RunbookStep[],
    rollbackSteps: row.rollback_steps as RunbookStep[],
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/**
 * POST /runbooks - Create a new runbook
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const errors = validateRunbookCreation(req.body);

  if (errors.length > 0) {
    const errorResponse = createValidationError('Validation failed', {
      fields: errors,
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  const { name, description, triggerConditions, steps, rollbackSteps } = req.body as {
    name: string;
    description: string;
    triggerConditions: TriggerCondition[];
    steps: RunbookStep[];
    rollbackSteps: RunbookStep[];
  };

  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    const insertQuery = `
      INSERT INTO runbooks (id, name, description, trigger_conditions, steps, rollback_steps, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING id, name, description, trigger_conditions, steps, rollback_steps, created_at, updated_at
    `;

    const result = await pool.query(insertQuery, [
      id,
      name,
      description,
      JSON.stringify(triggerConditions),
      JSON.stringify(steps),
      JSON.stringify(rollbackSteps),
      now,
    ]);

    const runbook = mapRowToRunbook(result.rows[0]);
    res.status(201).json(runbook);
  } catch (error) {
    console.error('Error creating runbook:', error);
    const errorResponse = createServiceUnavailableError('Failed to create runbook');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

/**
 * GET /runbooks - List all runbooks ordered by creation time descending
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const query = `
      SELECT id, name, description, trigger_conditions, steps, rollback_steps, created_at, updated_at
      FROM runbooks
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);
    const runbooks: Runbook[] = result.rows.map(mapRowToRunbook);

    res.status(200).json(runbooks);
  } catch (error) {
    console.error('Error listing runbooks:', error);
    const errorResponse = createServiceUnavailableError('Failed to retrieve runbooks');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

/**
 * GET /runbooks/:id - Get a runbook by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const query = `
      SELECT id, name, description, trigger_conditions, steps, rollback_steps, created_at, updated_at
      FROM runbooks
      WHERE id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      const errorResponse = createNotFoundError('Runbook', id);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    const runbook = mapRowToRunbook(result.rows[0]);
    res.status(200).json(runbook);
  } catch (error) {
    console.error('Error fetching runbook:', error);
    const errorResponse = createServiceUnavailableError('Failed to retrieve runbook');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

/**
 * POST /runbooks/:id/execute - Trigger runbook execution for an incident
 */
router.post('/:id/execute', async (req: Request, res: Response): Promise<void> => {
  const { id: runbookId } = req.params;
  const { incidentId } = req.body as { incidentId?: string };

  // Validate incidentId is provided
  if (!incidentId || typeof incidentId !== 'string' || incidentId.trim().length === 0) {
    const errorResponse = createValidationError('Validation failed', {
      fields: [{ field: 'incidentId', message: 'incidentId is required' }],
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  try {
    // Validate that the incident exists
    const incidentResult = await pool.query('SELECT id FROM incidents WHERE id = $1', [incidentId]);
    if (incidentResult.rows.length === 0) {
      const errorResponse = createValidationError('Referenced resource not found', {
        fields: [{ field: 'incidentId', message: `Incident with id '${incidentId}' was not found` }],
      });
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    // Validate that the runbook exists
    const runbookResult = await pool.query('SELECT id FROM runbooks WHERE id = $1', [runbookId]);
    if (runbookResult.rows.length === 0) {
      const errorResponse = createValidationError('Referenced resource not found', {
        fields: [{ field: 'runbookId', message: `Runbook with id '${runbookId}' was not found` }],
      });
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    // Create runbook_execution record with status "pending"
    const executionId = uuidv4();
    const insertQuery = `
      INSERT INTO runbook_executions (id, incident_id, runbook_id, status, step_results, started_at, completed_at, error, last_progress_at)
      VALUES ($1, $2, $3, 'pending', '[]', NULL, NULL, NULL, NULL)
    `;
    await pool.query(insertQuery, [executionId, incidentId, runbookId]);

    // Publish execution event to Redis Stream
    await redis.xadd('runbook-executions', '*', 'executionId', executionId, 'runbookId', runbookId, 'incidentId', incidentId);

    // Return 202 Accepted with execution ID
    res.status(202).json({ executionId, status: 'pending' });
  } catch (error) {
    console.error('Error triggering runbook execution:', error);
    const errorResponse = createServiceUnavailableError('Failed to trigger runbook execution');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

export { router as runbooksRouter };
