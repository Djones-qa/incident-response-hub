import { Router, Request, Response } from 'express';
import type { IncidentStatus } from '@incident-hub/shared-types';
import { pool } from '../db.js';
import { publishIncidentEvent } from '../events.js';
import { createValidationError, createNotFoundError } from '@incident-hub/shared-utils';

const router = Router();

/**
 * Valid state machine transitions.
 * Strictly linear: declared → investigating → mitigating → resolved → closed
 */
const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  declared: ['investigating'],
  investigating: ['mitigating'],
  mitigating: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

/**
 * Hash a UUID string to a bigint suitable for pg_advisory_xact_lock.
 * Uses a simple hash derived from the UUID hex characters.
 */
function uuidToBigInt(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  // Take first 15 hex chars to stay within safe integer range for bigint
  const num = BigInt('0x' + hex.substring(0, 15));
  return num.toString();
}

/**
 * PATCH /incidents/:id/status
 *
 * Transitions an incident's status according to the state machine.
 * Uses PostgreSQL advisory locks for concurrent transition serialization.
 */
router.patch('/:id/status', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status: targetStatus } = req.body;

  // Validate request body
  if (!targetStatus) {
    const error = createValidationError('Target status is required', {
      field: 'status',
    });
    res.status(error.statusCode).json(error);
    return;
  }

  const validStatuses: IncidentStatus[] = [
    'declared',
    'investigating',
    'mitigating',
    'resolved',
    'closed',
  ];

  if (!validStatuses.includes(targetStatus)) {
    const error = createValidationError(`Invalid status value: '${targetStatus}'`, {
      field: 'status',
      allowedValues: validStatuses,
    });
    res.status(error.statusCode).json(error);
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Acquire advisory lock based on incident UUID hash for serialization
    const lockId = uuidToBigInt(id);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockId]);

    // Read current incident status
    const incidentResult = await client.query(
      'SELECT id, status FROM incidents WHERE id = $1',
      [id],
    );

    if (incidentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const error = createNotFoundError('Incident', id);
      res.status(error.statusCode).json(error);
      return;
    }

    const currentStatus: IncidentStatus = incidentResult.rows[0].status;

    // Validate the transition
    const allowedTransitions = VALID_TRANSITIONS[currentStatus];
    if (!allowedTransitions.includes(targetStatus)) {
      await client.query('ROLLBACK');
      const error = createValidationError(
        `Invalid status transition from '${currentStatus}' to '${targetStatus}'`,
        {
          currentStatus,
          targetStatus,
          allowedTransitions,
        },
      );
      res.status(error.statusCode).json(error);
      return;
    }

    // For mitigating → resolved: require at least one "resolution" timeline entry
    if (currentStatus === 'mitigating' && targetStatus === 'resolved') {
      const resolutionCheck = await client.query(
        `SELECT COUNT(*) as count FROM timeline_entries 
         WHERE incident_id = $1 AND type = 'resolution'`,
        [id],
      );

      if (parseInt(resolutionCheck.rows[0].count, 10) === 0) {
        await client.query('ROLLBACK');
        const error = createValidationError(
          'Cannot transition to resolved: at least one resolution timeline entry is required',
          {
            currentStatus,
            targetStatus,
            requirement: 'At least one timeline entry of type "resolution" must exist',
          },
        );
        res.status(error.statusCode).json(error);
        return;
      }
    }

    // Build the update query based on target status
    const now = new Date().toISOString();
    let updateQuery: string;
    let updateParams: unknown[];

    if (targetStatus === 'resolved') {
      updateQuery = `UPDATE incidents 
        SET status = $1, resolved_at = $2, updated_at = $2 
        WHERE id = $3
        RETURNING *`;
      updateParams = [targetStatus, now, id];
    } else if (targetStatus === 'closed') {
      updateQuery = `UPDATE incidents 
        SET status = $1, closed_at = $2, updated_at = $2 
        WHERE id = $3
        RETURNING *`;
      updateParams = [targetStatus, now, id];
    } else {
      updateQuery = `UPDATE incidents 
        SET status = $1, updated_at = $2 
        WHERE id = $3
        RETURNING *`;
      updateParams = [targetStatus, now, id];
    }

    const updateResult = await client.query(updateQuery, updateParams);

    // Auto-create timeline entry recording the status transition
    await client.query(
      `INSERT INTO timeline_entries (incident_id, type, author, content, metadata)
       VALUES ($1, 'action', 'system', $2, $3)`,
      [
        id,
        `Status changed from '${currentStatus}' to '${targetStatus}'`,
        JSON.stringify({
          previousStatus: currentStatus,
          newStatus: targetStatus,
        }),
      ],
    );

    await client.query('COMMIT');

    // Map DB row to response
    const row = updateResult.rows[0];
    const incident = {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      affectedServices: row.affected_services,
      assignedResponders: row.assigned_responders,
      declaredAt: row.declared_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
      closedAt: row.closed_at ? row.closed_at.toISOString() : null,
      updatedAt: row.updated_at.toISOString(),
    };

    res.status(200).json(incident);

    // Publish status changed event (fire-and-forget)
    publishIncidentEvent({
      type: 'status_changed',
      incidentId: id,
      timestamp: now,
      payload: {
        previousStatus: currentStatus,
        newStatus: targetStatus,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Status transition error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during status transition',
      },
      statusCode: 500,
    });
  } finally {
    client.release();
  }
});

export { router as statusRouter };
