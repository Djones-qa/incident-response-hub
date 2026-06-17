import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  IncidentDeclarationRequest,
  IncidentListQuery,
  PaginatedResponse,
  Severity,
  IncidentStatus,
  Incident,
  TimelineEntry,
} from '@incident-hub/shared-types';
import {
  isValidSeverity,
  isValidStatus,
  isValidISODate,
  isWithinLength,
  createValidationError,
  createNotFoundError,
  createServiceUnavailableError,
} from '@incident-hub/shared-utils';
import { pool } from '../db.js';
import { publishIncidentEvent } from '../events.js';

const router = Router();

interface FieldError {
  field: string;
  message: string;
}

function validateIncidentDeclaration(body: unknown): FieldError[] {
  const errors: FieldError[] = [];
  const request = body as Record<string, unknown>;

  // Validate title
  if (request.title === undefined || request.title === null) {
    errors.push({ field: 'title', message: 'title is required' });
  } else if (typeof request.title !== 'string' || request.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'title must not be empty or whitespace-only' });
  } else if (!isWithinLength(request.title, 200)) {
    errors.push({ field: 'title', message: 'title must not exceed 200 characters' });
  }

  // Validate description
  if (request.description === undefined || request.description === null) {
    errors.push({ field: 'description', message: 'description is required' });
  } else if (typeof request.description !== 'string' || request.description.trim().length === 0) {
    errors.push({
      field: 'description',
      message: 'description must not be empty or whitespace-only',
    });
  } else if (!isWithinLength(request.description, 5000)) {
    errors.push({ field: 'description', message: 'description must not exceed 5000 characters' });
  }

  // Validate severity
  if (request.severity === undefined || request.severity === null) {
    errors.push({ field: 'severity', message: 'severity is required' });
  } else if (typeof request.severity !== 'string' || !isValidSeverity(request.severity)) {
    errors.push({
      field: 'severity',
      message: 'severity must be one of: critical, high, medium, low',
    });
  }

  // Validate affectedServices
  if (request.affectedServices === undefined || request.affectedServices === null) {
    errors.push({ field: 'affectedServices', message: 'affectedServices is required' });
  } else if (!Array.isArray(request.affectedServices)) {
    errors.push({ field: 'affectedServices', message: 'affectedServices must be an array' });
  } else if (request.affectedServices.length === 0) {
    errors.push({
      field: 'affectedServices',
      message: 'affectedServices must contain at least one service',
    });
  } else {
    const hasInvalidEntry = request.affectedServices.some(
      (s: unknown) => typeof s !== 'string' || s.trim().length === 0,
    );
    if (hasInvalidEntry) {
      errors.push({
        field: 'affectedServices',
        message: 'each affected service must be a non-empty string',
      });
    }
  }

  return errors;
}

/**
 * POST /incidents - Declare a new incident
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const errors = validateIncidentDeclaration(req.body);

  if (errors.length > 0) {
    const errorResponse = createValidationError('Validation failed', {
      fields: errors,
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  const { title, description, severity, affectedServices } =
    req.body as IncidentDeclarationRequest;

  const incidentId = uuidv4();
  const timelineEntryId = uuidv4();
  const now = new Date().toISOString();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert the incident
    const insertIncidentQuery = `
      INSERT INTO incidents (id, title, description, severity, status, affected_services, assigned_responders, declared_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'declared', $5, '{}', $6, $6, $6)
      RETURNING id, title, description, severity, status, affected_services, assigned_responders, declared_at, created_at, resolved_at, closed_at, updated_at
    `;

    const incidentResult = await client.query(insertIncidentQuery, [
      incidentId,
      title,
      description,
      severity,
      `{${affectedServices.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`,
      now,
    ]);

    // Auto-create timeline entry of type "detection"
    const timelineContent = `Incident declared: ${title} [${severity.toUpperCase()}] - Affected services: ${affectedServices.join(', ')}`;
    const timelineMetadata = JSON.stringify({
      severity,
      affectedServices: affectedServices.join(', '),
    });

    const insertTimelineQuery = `
      INSERT INTO timeline_entries (id, incident_id, type, author, content, metadata, created_at)
      VALUES ($1, $2, 'detection', 'system', $3, $4, $5)
    `;

    await client.query(insertTimelineQuery, [
      timelineEntryId,
      incidentId,
      timelineContent,
      timelineMetadata,
      now,
    ]);

    await client.query('COMMIT');

    const row = incidentResult.rows[0];
    const incident: Incident = {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity as Severity,
      status: row.status,
      affectedServices: row.affected_services,
      assignedResponders: row.assigned_responders || [],
      declaredAt: new Date(row.declared_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    res.status(201).json(incident);

    // Publish incident declared event (fire-and-forget)
    publishIncidentEvent({
      type: 'declared',
      incidentId: incident.id,
      timestamp: incident.createdAt,
      payload: {
        title: incident.title,
        severity: incident.severity,
        affectedServices: incident.affectedServices,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating incident:', error);
    const errorResponse = createServiceUnavailableError('Failed to create incident');
    res.status(errorResponse.statusCode).json(errorResponse);
  } finally {
    client.release();
  }
});

/**
 * Helper to map a database row to an Incident object
 */
function mapRowToIncident(row: Record<string, unknown>): Incident {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    severity: row.severity as Severity,
    status: row.status as IncidentStatus,
    affectedServices: row.affected_services as string[],
    assignedResponders: (row.assigned_responders as string[]) || [],
    declaredAt: new Date(row.declared_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : null,
    closedAt: row.closed_at ? new Date(row.closed_at as string).toISOString() : null,
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/**
 * GET /incidents - List incidents with filters and pagination
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const query = req.query as Record<string, string | undefined>;

  // Parse and validate query parameters
  const status = query.status;
  const severity = query.severity;
  const startDate = query.startDate;
  const endDate = query.endDate;
  const pageParam = query.page;
  const pageSizeParam = query.pageSize;

  // Validate status filter
  if (status !== undefined && !isValidStatus(status)) {
    const errorResponse = createValidationError('Invalid status filter', {
      field: 'status',
      message: 'status must be one of: declared, investigating, mitigating, resolved, closed',
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  // Validate severity filter
  if (severity !== undefined && !isValidSeverity(severity)) {
    const errorResponse = createValidationError('Invalid severity filter', {
      field: 'severity',
      message: 'severity must be one of: critical, high, medium, low',
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  // Validate startDate
  if (startDate !== undefined && !isValidISODate(startDate)) {
    const errorResponse = createValidationError('Invalid startDate filter', {
      field: 'startDate',
      message: 'startDate must be a valid ISO 8601 date string',
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  // Validate endDate
  if (endDate !== undefined && !isValidISODate(endDate)) {
    const errorResponse = createValidationError('Invalid endDate filter', {
      field: 'endDate',
      message: 'endDate must be a valid ISO 8601 date string',
    });
    res.status(errorResponse.statusCode).json(errorResponse);
    return;
  }

  // Parse and validate pagination
  let page = 1;
  let pageSize = 20;

  if (pageParam !== undefined) {
    const parsed = parseInt(pageParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      const errorResponse = createValidationError('Invalid page parameter', {
        field: 'page',
        message: 'page must be a positive integer',
      });
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }
    page = parsed;
  }

  if (pageSizeParam !== undefined) {
    const parsed = parseInt(pageSizeParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      const errorResponse = createValidationError('Invalid pageSize parameter', {
        field: 'pageSize',
        message: 'pageSize must be an integer between 1 and 100',
      });
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }
    pageSize = parsed;
  }

  try {
    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (severity) {
      conditions.push(`severity = $${paramIndex}`);
      params.push(severity);
      paramIndex++;
    }

    if (startDate) {
      conditions.push(`declared_at >= $${paramIndex}`);
      params.push(new Date(startDate).toISOString());
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`declared_at <= $${paramIndex}`);
      params.push(new Date(endDate).toISOString());
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM incidents ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated results ordered by declared_at descending
    const offset = (page - 1) * pageSize;
    const dataQuery = `
      SELECT id, title, description, severity, status, affected_services, assigned_responders, declared_at, created_at, resolved_at, closed_at, updated_at
      FROM incidents
      ${whereClause}
      ORDER BY declared_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(pageSize, offset);

    const dataResult = await pool.query(dataQuery, params);
    const data: Incident[] = dataResult.rows.map(mapRowToIncident);

    const response: PaginatedResponse<Incident> = {
      data,
      total,
      page,
      pageSize,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error listing incidents:', error);
    const errorResponse = createServiceUnavailableError('Failed to retrieve incidents');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

/**
 * GET /incidents/:id - Get incident by ID with timeline entries
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    // Fetch the incident
    const incidentQuery = `
      SELECT id, title, description, severity, status, affected_services, assigned_responders, declared_at, created_at, resolved_at, closed_at, updated_at
      FROM incidents
      WHERE id = $1
    `;
    const incidentResult = await pool.query(incidentQuery, [id]);

    if (incidentResult.rows.length === 0) {
      const errorResponse = createNotFoundError('Incident', id);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    const incident = mapRowToIncident(incidentResult.rows[0]);

    // Fetch timeline entries ordered by created_at ascending
    const timelineQuery = `
      SELECT id, incident_id, type, author, content, metadata, created_at
      FROM timeline_entries
      WHERE incident_id = $1
      ORDER BY created_at ASC
    `;
    const timelineResult = await pool.query(timelineQuery, [id]);

    const timeline: TimelineEntry[] = timelineResult.rows.map((row) => ({
      id: row.id as string,
      incidentId: row.incident_id as string,
      type: row.type as TimelineEntry['type'],
      author: row.author as string,
      content: row.content as string,
      metadata: row.metadata as Record<string, string> | null,
      createdAt: new Date(row.created_at as string).toISOString(),
    }));

    res.status(200).json({ ...incident, timeline });
  } catch (error) {
    console.error('Error fetching incident:', error);
    const errorResponse = createServiceUnavailableError('Failed to retrieve incident');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

export { router as incidentsRouter };
