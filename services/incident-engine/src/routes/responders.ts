import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Incident } from '@incident-hub/shared-types';
import { createValidationError, createNotFoundError } from '@incident-hub/shared-utils';
import { pool } from '../db.js';
import { publishIncidentEvent } from '../events.js';

const router = Router();

const ACTIVE_STATUSES = ['declared', 'investigating', 'mitigating'];
const MAX_RESPONDERS_PER_REQUEST = 20;

/**
 * POST /incidents/:id/responders
 * Assign responders to an incident.
 * Accepts an array of responder IDs, deduplicates against existing assignments.
 * Rejects assignment on resolved/closed incidents.
 * Auto-creates an "action" timeline entry recording the assignment.
 */
router.post('/:id/responders', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { responders } = req.body;

  // Validate request body
  if (!responders || !Array.isArray(responders)) {
    const error = createValidationError('responders must be a non-empty array of strings', {
      field: 'responders',
    });
    res.status(error.statusCode).json(error);
    return;
  }

  if (responders.length === 0) {
    const error = createValidationError('responders array must not be empty', {
      field: 'responders',
    });
    res.status(error.statusCode).json(error);
    return;
  }

  if (responders.length > MAX_RESPONDERS_PER_REQUEST) {
    const error = createValidationError(
      `responders array must not exceed ${MAX_RESPONDERS_PER_REQUEST} entries`,
      { field: 'responders', maxAllowed: MAX_RESPONDERS_PER_REQUEST, provided: responders.length },
    );
    res.status(error.statusCode).json(error);
    return;
  }

  // Validate each responder is a non-empty string
  const hasInvalidEntry = responders.some(
    (r: unknown) => typeof r !== 'string' || r.trim().length === 0,
  );
  if (hasInvalidEntry) {
    const error = createValidationError('each responder must be a non-empty string', {
      field: 'responders',
    });
    res.status(error.statusCode).json(error);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the incident with lock
    const incidentResult = await client.query(
      'SELECT id, status, assigned_responders FROM incidents WHERE id = $1 FOR UPDATE',
      [id],
    );

    if (incidentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const error = createNotFoundError('Incident', id);
      res.status(error.statusCode).json(error);
      return;
    }

    const incident = incidentResult.rows[0];
    const currentStatus: string = incident.status;

    // Reject assignment on resolved/closed incidents
    if (!ACTIVE_STATUSES.includes(currentStatus)) {
      await client.query('ROLLBACK');
      const error = createValidationError(
        `Cannot assign responders to an incident with status '${currentStatus}'. Assignments are only allowed during active statuses (declared, investigating, mitigating).`,
        { currentStatus, allowedStatuses: ACTIVE_STATUSES },
      );
      res.status(error.statusCode).json(error);
      return;
    }

    // Deduplicate: merge new responders with existing, removing duplicates
    const existingResponders: string[] = incident.assigned_responders || [];
    const existingSet = new Set(existingResponders);
    const newResponders = (responders as string[]).filter((r) => !existingSet.has(r));

    // Deduplicate within the request itself
    const uniqueNewResponders = [...new Set(newResponders)];

    // Merge existing + new
    const mergedResponders = [...existingResponders, ...uniqueNewResponders];

    // Update the incident
    const now = new Date().toISOString();
    const respondersArray = `{${mergedResponders.map((r) => `"${r.replace(/"/g, '\\"')}"`).join(',')}}`;

    await client.query(
      'UPDATE incidents SET assigned_responders = $1, updated_at = $2 WHERE id = $3',
      [respondersArray, now, id],
    );

    // Auto-create "action" timeline entry recording assignment
    const timelineId = uuidv4();
    const assignedList = uniqueNewResponders.length > 0 ? uniqueNewResponders : (responders as string[]);
    const timelineContent = `Responders assigned: ${assignedList.join(', ')}`;

    await client.query(
      `INSERT INTO timeline_entries (id, incident_id, type, author, content, metadata, created_at)
       VALUES ($1, $2, 'action', 'system', $3, $4, $5)`,
      [
        timelineId,
        id,
        timelineContent,
        JSON.stringify({ responders: assignedList }),
        now,
      ],
    );

    await client.query('COMMIT');

    // Return the full updated incident
    const updatedResult = await client.query(
      `SELECT id, title, description, severity, status, affected_services, assigned_responders,
              declared_at, created_at, resolved_at, closed_at, updated_at
       FROM incidents WHERE id = $1`,
      [id],
    );

    const updated = updatedResult.rows[0];
    const response: Incident = {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      severity: updated.severity,
      status: updated.status,
      affectedServices: updated.affected_services,
      assignedResponders: updated.assigned_responders || [],
      declaredAt: new Date(updated.declared_at).toISOString(),
      createdAt: new Date(updated.created_at).toISOString(),
      resolvedAt: updated.resolved_at ? new Date(updated.resolved_at).toISOString() : null,
      closedAt: updated.closed_at ? new Date(updated.closed_at).toISOString() : null,
      updatedAt: new Date(updated.updated_at).toISOString(),
    };

    res.status(200).json(response);

    // Publish responder assigned event (fire-and-forget)
    publishIncidentEvent({
      type: 'responder_assigned',
      incidentId: id,
      timestamp: now,
      payload: {
        responders: assignedList,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error assigning responders:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      statusCode: 500,
    });
  } finally {
    client.release();
  }
});

export { router as respondersRouter };
