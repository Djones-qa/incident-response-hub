import { Router, Request, Response } from 'express';
import type { TriggerCondition, Runbook, Incident } from '@incident-hub/shared-types';
import { createNotFoundError, createServiceUnavailableError } from '@incident-hub/shared-utils';
import { pool } from '../db.js';

const router = Router();

/**
 * Evaluates a single trigger condition against an incident's field value.
 *
 * Operators:
 * - equals: case-sensitive exact match
 * - contains: case-insensitive substring match
 * - gt: numeric greater-than (non-numeric field values → non-matching)
 * - lt: numeric less-than (non-numeric field values → non-matching)
 */
function evaluateCondition(fieldValue: string, condition: TriggerCondition): boolean {
  const { operator, value } = condition;

  switch (operator) {
    case 'equals':
      return fieldValue === value;

    case 'contains':
      return fieldValue.toLowerCase().includes(value.toLowerCase());

    case 'gt': {
      const numField = Number(fieldValue);
      const numValue = Number(value);
      if (isNaN(numField) || isNaN(numValue)) {
        return false;
      }
      return numField > numValue;
    }

    case 'lt': {
      const numField = Number(fieldValue);
      const numValue = Number(value);
      if (isNaN(numField) || isNaN(numValue)) {
        return false;
      }
      return numField < numValue;
    }

    default:
      return false;
  }
}

/**
 * Resolves the incident field value for a given trigger condition field name.
 * For affectedServices, returns a comma-joined string for substring matching.
 */
function getIncidentFieldValue(incident: Incident, field: string): string | undefined {
  switch (field) {
    case 'title':
      return incident.title;
    case 'description':
      return incident.description;
    case 'severity':
      return incident.severity;
    case 'status':
      return incident.status;
    case 'affectedServices':
      return incident.affectedServices.join(',');
    default:
      return undefined;
  }
}

/**
 * Checks if all trigger conditions of a runbook match the given incident.
 * A runbook with no trigger conditions does not match (no conditions = no match).
 */
function runbookMatchesIncident(runbook: Runbook, incident: Incident): boolean {
  const conditions = runbook.triggerConditions;

  if (!conditions || conditions.length === 0) {
    return false;
  }

  return conditions.every((condition) => {
    const fieldValue = getIncidentFieldValue(incident, condition.field);
    if (fieldValue === undefined) {
      return false;
    }
    return evaluateCondition(fieldValue, condition);
  });
}

/**
 * GET /incidents/:id/suggested-runbooks
 * Returns runbooks whose trigger conditions all match the incident's attributes.
 * Results are ordered by creation time ascending (oldest first).
 */
router.get('/:id/suggested-runbooks', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    // Check if incident exists
    const incidentQuery = `
      SELECT id, title, description, severity, status, affected_services, assigned_responders,
             declared_at, created_at, resolved_at, closed_at, updated_at
      FROM incidents
      WHERE id = $1
    `;
    const incidentResult = await pool.query(incidentQuery, [id]);

    if (incidentResult.rows.length === 0) {
      const errorResponse = createNotFoundError('Incident', id);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    const row = incidentResult.rows[0];
    const incident: Incident = {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      affectedServices: row.affected_services || [],
      assignedResponders: row.assigned_responders || [],
      declaredAt: new Date(row.declared_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    // Fetch all runbooks ordered by created_at ASC
    const runbooksQuery = `
      SELECT id, name, description, trigger_conditions, steps, rollback_steps, created_at, updated_at
      FROM runbooks
      ORDER BY created_at ASC
    `;
    const runbooksResult = await pool.query(runbooksQuery);

    const allRunbooks: Runbook[] = runbooksResult.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      triggerConditions: r.trigger_conditions || [],
      steps: r.steps || [],
      rollbackSteps: r.rollback_steps || [],
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));

    // Filter runbooks where ALL trigger conditions match
    const matchingRunbooks = allRunbooks.filter((runbook) =>
      runbookMatchesIncident(runbook, incident),
    );

    res.status(200).json(matchingRunbooks);
  } catch (error) {
    console.error('Error fetching suggested runbooks:', error);
    const errorResponse = createServiceUnavailableError('Failed to retrieve suggested runbooks');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

export { router as suggestedRunbooksRouter };
