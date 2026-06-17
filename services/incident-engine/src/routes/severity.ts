import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Severity } from '@incident-hub/shared-types';
import { createValidationError, createNotFoundError } from '@incident-hub/shared-utils';
import { pool } from '../db.js';
import { publishIncidentEvent } from '../events.js';

const router = Router();

const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const VALID_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const ACTIVE_STATUSES = ['declared', 'investigating', 'mitigating'];

/**
 * PATCH /incidents/:id/severity
 * Escalate the severity of an incident.
 * Only allows escalation (not downgrade or same-level) during active statuses.
 */
router.patch('/:id/severity', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { severity: newSeverity } = req.body;

  // Validate request body
  if (!newSeverity || !VALID_SEVERITIES.includes(newSeverity)) {
    const error = createValidationError('Invalid severity value. Must be one of: low, medium, high, critical', {
      field: 'severity',
      provided: newSeverity ?? null,
    });
    res.status(error.statusCode).json(error);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the incident
    const incidentResult = await client.query(
      'SELECT id, severity, status FROM incidents WHERE id = $1 FOR UPDATE',
      [id],
    );

    if (incidentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const error = createNotFoundError('Incident', id);
      res.status(error.statusCode).json(error);
      return;
    }

    const incident = incidentResult.rows[0];
    const currentSeverity: Severity = incident.severity;
    const currentStatus: string = incident.status;

    // Check if incident is in an active status
    if (!ACTIVE_STATUSES.includes(currentStatus)) {
      await client.query('ROLLBACK');
      const error = createValidationError(
        `Cannot change severity on an incident with status '${currentStatus}'. Severity changes are only allowed during active statuses (declared, investigating, mitigating).`,
        { currentStatus, allowedStatuses: ACTIVE_STATUSES },
      );
      res.status(error.statusCode).json(error);
      return;
    }

    // Check if already at critical
    if (currentSeverity === 'critical') {
      await client.query('ROLLBACK');
      const error = createValidationError(
        'Incident is already at critical severity. Cannot escalate further.',
        { currentSeverity },
      );
      res.status(error.statusCode).json(error);
      return;
    }

    // Enforce escalation only (no downgrade or same-level)
    const currentLevel = SEVERITY_ORDER[currentSeverity];
    const newLevel = SEVERITY_ORDER[newSeverity as Severity];

    if (newLevel <= currentLevel) {
      await client.query('ROLLBACK');
      const error = createValidationError(
        `Severity can only be escalated. Cannot change from '${currentSeverity}' to '${newSeverity}'.`,
        { currentSeverity, requestedSeverity: newSeverity, reason: newLevel === currentLevel ? 'same_level' : 'downgrade' },
      );
      res.status(error.statusCode).json(error);
      return;
    }

    // Update the severity
    const now = new Date().toISOString();
    await client.query(
      'UPDATE incidents SET severity = $1, updated_at = $2 WHERE id = $3',
      [newSeverity, now, id],
    );

    // Auto-create escalation timeline entry
    const timelineId = uuidv4();
    await client.query(
      `INSERT INTO timeline_entries (id, incident_id, type, author, content, metadata, created_at)
       VALUES ($1, $2, 'escalation', 'system', $3, $4, $5)`,
      [
        timelineId,
        id,
        `Severity escalated from ${currentSeverity} to ${newSeverity}`,
        JSON.stringify({ previousSeverity: currentSeverity, newSeverity }),
        now,
      ],
    );

    await client.query('COMMIT');

    // Return updated incident
    const updatedResult = await client.query(
      `SELECT id, title, description, severity, status, affected_services, assigned_responders,
              declared_at, created_at, resolved_at, closed_at, updated_at
       FROM incidents WHERE id = $1`,
      [id],
    );

    const updated = updatedResult.rows[0];
    res.status(200).json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      severity: updated.severity,
      status: updated.status,
      affectedServices: updated.affected_services,
      assignedResponders: updated.assigned_responders,
      declaredAt: updated.declared_at,
      createdAt: updated.created_at,
      resolvedAt: updated.resolved_at,
      closedAt: updated.closed_at,
      updatedAt: updated.updated_at,
    });

    // Publish severity changed event (fire-and-forget)
    publishIncidentEvent({
      type: 'severity_changed',
      incidentId: id,
      timestamp: now,
      payload: {
        previousSeverity: currentSeverity,
        newSeverity,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error escalating severity:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      statusCode: 500,
    });
  } finally {
    client.release();
  }
});

export { router as severityRouter };
