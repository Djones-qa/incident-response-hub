import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { TimelineEntryType, TimelineEntry, TimelineEntryRequest } from '@incident-hub/shared-types';
import {
  createValidationError,
  createNotFoundError,
  createServiceUnavailableError,
} from '@incident-hub/shared-utils';
import { pool } from '../db.js';

const router = Router();

const VALID_TIMELINE_ENTRY_TYPES: TimelineEntryType[] = [
  'detection',
  'action',
  'communication',
  'escalation',
  'resolution',
  'note',
];

interface FieldError {
  field: string;
  message: string;
}

function validateTimelineEntry(body: unknown): FieldError[] {
  const errors: FieldError[] = [];
  const request = body as Record<string, unknown>;

  // Validate type
  if (request.type === undefined || request.type === null) {
    errors.push({ field: 'type', message: 'type is required' });
  } else if (
    typeof request.type !== 'string' ||
    !VALID_TIMELINE_ENTRY_TYPES.includes(request.type as TimelineEntryType)
  ) {
    errors.push({
      field: 'type',
      message: `type must be one of: ${VALID_TIMELINE_ENTRY_TYPES.join(', ')}`,
    });
  }

  // Validate author
  if (request.author === undefined || request.author === null) {
    errors.push({ field: 'author', message: 'author is required' });
  } else if (typeof request.author !== 'string' || request.author.trim().length === 0) {
    errors.push({ field: 'author', message: 'author must not be empty or whitespace-only' });
  } else if (request.author.length > 200) {
    errors.push({ field: 'author', message: 'author must not exceed 200 characters' });
  }

  // Validate content
  if (request.content === undefined || request.content === null) {
    errors.push({ field: 'content', message: 'content is required' });
  } else if (typeof request.content !== 'string' || request.content.trim().length === 0) {
    errors.push({ field: 'content', message: 'content must not be empty or whitespace-only' });
  } else if (request.content.length > 5000) {
    errors.push({ field: 'content', message: 'content must not exceed 5000 characters' });
  }

  // Validate metadata (optional)
  if (request.metadata !== undefined && request.metadata !== null) {
    if (typeof request.metadata !== 'object' || Array.isArray(request.metadata)) {
      errors.push({ field: 'metadata', message: 'metadata must be an object' });
    } else {
      const metadata = request.metadata as Record<string, unknown>;
      const keys = Object.keys(metadata);

      if (keys.length > 20) {
        errors.push({ field: 'metadata', message: 'metadata must not exceed 20 keys' });
      } else {
        for (const key of keys) {
          if (key.length > 100) {
            errors.push({
              field: 'metadata',
              message: `metadata key '${key.substring(0, 20)}...' must not exceed 100 characters`,
            });
            break;
          }
          const value = metadata[key];
          if (typeof value !== 'string') {
            errors.push({
              field: 'metadata',
              message: `metadata values must be strings`,
            });
            break;
          }
          if (value.length > 500) {
            errors.push({
              field: 'metadata',
              message: `metadata value for key '${key.substring(0, 20)}' must not exceed 500 characters`,
            });
            break;
          }
        }
      }
    }
  }

  return errors;
}

/**
 * POST /incidents/:id/timeline - Add a timeline entry to an incident
 */
router.post('/:id/timeline', async (req: Request, res: Response): Promise<void> => {
  const incidentId = req.params.id;

  try {
    // First check that the incident exists
    const incidentCheck = await pool.query('SELECT id FROM incidents WHERE id = $1', [incidentId]);

    if (incidentCheck.rows.length === 0) {
      const errorResponse = createNotFoundError('Incident', incidentId);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    // Validate the request body
    const errors = validateTimelineEntry(req.body);

    if (errors.length > 0) {
      const errorResponse = createValidationError('Validation failed', {
        fields: errors,
      });
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    const { type, author, content, metadata } = req.body as TimelineEntryRequest;

    const entryId = uuidv4();
    const now = new Date().toISOString();

    const insertQuery = `
      INSERT INTO timeline_entries (id, incident_id, type, author, content, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, incident_id, type, author, content, metadata, created_at
    `;

    const result = await pool.query(insertQuery, [
      entryId,
      incidentId,
      type,
      author,
      content,
      metadata ? JSON.stringify(metadata) : null,
      now,
    ]);

    const row = result.rows[0];
    const entry: TimelineEntry = {
      id: row.id,
      incidentId: row.incident_id,
      type: row.type as TimelineEntryType,
      author: row.author,
      content: row.content,
      metadata: row.metadata,
      createdAt: new Date(row.created_at).toISOString(),
    };

    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating timeline entry:', error);
    const errorResponse = createServiceUnavailableError('Failed to create timeline entry');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

/**
 * GET /incidents/:id/timeline - Get timeline entries for an incident
 */
router.get('/:id/timeline', async (req: Request, res: Response): Promise<void> => {
  const incidentId = req.params.id;

  try {
    // First check that the incident exists
    const incidentCheck = await pool.query('SELECT id FROM incidents WHERE id = $1', [incidentId]);

    if (incidentCheck.rows.length === 0) {
      const errorResponse = createNotFoundError('Incident', incidentId);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    const selectQuery = `
      SELECT id, incident_id, type, author, content, metadata, created_at
      FROM timeline_entries
      WHERE incident_id = $1
      ORDER BY created_at ASC
    `;

    const result = await pool.query(selectQuery, [incidentId]);

    const entries: TimelineEntry[] = result.rows.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      type: row.type as TimelineEntryType,
      author: row.author,
      content: row.content,
      metadata: row.metadata,
      createdAt: new Date(row.created_at).toISOString(),
    }));

    res.status(200).json(entries);
  } catch (error) {
    console.error('Error fetching timeline entries:', error);
    const errorResponse = createServiceUnavailableError('Failed to fetch timeline entries');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

export { router as timelineRouter };
