import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { PostMortem, TimelineEntry } from '@incident-hub/shared-types';
import {
  createValidationError,
  createNotFoundError,
  createServiceUnavailableError,
} from '@incident-hub/shared-utils';
import { pool } from '../db.js';

const router = Router();

/**
 * POST /incidents/:id/postmortem - Generate post-mortem for a resolved/closed incident
 */
router.post('/:id/postmortem', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    // Fetch the incident
    const incidentQuery = `
      SELECT id, status, affected_services, declared_at, resolved_at
      FROM incidents
      WHERE id = $1
    `;
    const incidentResult = await pool.query(incidentQuery, [id]);

    if (incidentResult.rows.length === 0) {
      const errorResponse = createNotFoundError('Incident', id);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    const incident = incidentResult.rows[0];

    // Validate incident is resolved or closed
    if (incident.status !== 'resolved' && incident.status !== 'closed') {
      const errorResponse = createValidationError(
        'Post-mortem can only be generated for resolved or closed incidents',
      );
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    // Check for existing post-mortem (conflict)
    const existingQuery = `
      SELECT id FROM post_mortems WHERE incident_id = $1
    `;
    const existingResult = await pool.query(existingQuery, [id]);

    if (existingResult.rows.length > 0) {
      const errorResponse = {
        error: {
          code: 'CONFLICT',
          message: 'A post-mortem already exists for this incident',
        },
        statusCode: 409,
      };
      res.status(409).json(errorResponse);
      return;
    }

    // Calculate impact duration in minutes
    const declaredAt = new Date(incident.declared_at);
    const resolvedAt = new Date(incident.resolved_at);
    const impactDurationMinutes = Math.floor(
      (resolvedAt.getTime() - declaredAt.getTime()) / 60000,
    );

    // Build impact assessment
    const affectedServices: string[] = incident.affected_services;
    const impactAssessment = {
      affectedServices,
      durationMinutes: impactDurationMinutes,
    };

    const postMortemId = uuidv4();
    const now = new Date().toISOString();

    // Insert post-mortem record
    const insertQuery = `
      INSERT INTO post_mortems (id, incident_id, status, summary, root_cause, impact_assessment, action_items, lessons, impact_duration_minutes, created_at, updated_at)
      VALUES ($1, $2, 'draft', '', '', $3, '[]', '', $4, $5, $5)
      RETURNING id, incident_id, status, summary, root_cause, impact_assessment, action_items, lessons, impact_duration_minutes, created_at, updated_at
    `;

    const insertResult = await pool.query(insertQuery, [
      postMortemId,
      id,
      JSON.stringify(impactAssessment),
      impactDurationMinutes,
      now,
    ]);

    // Fetch timeline entries for the response
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

    const row = insertResult.rows[0];
    const postMortem: PostMortem = {
      id: row.id,
      incidentId: row.incident_id,
      status: row.status,
      summary: row.summary,
      rootCause: row.root_cause,
      impactAssessment: row.impact_assessment,
      actionItems: row.action_items,
      lessons: row.lessons,
      timeline,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    res.status(201).json(postMortem);
  } catch (error) {
    console.error('Error generating post-mortem:', error);
    const errorResponse = createServiceUnavailableError('Failed to generate post-mortem');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

/**
 * GET /incidents/:id/postmortem - Retrieve post-mortem document
 */
router.get('/:id/postmortem', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    // Verify incident exists
    const incidentQuery = `SELECT id FROM incidents WHERE id = $1`;
    const incidentResult = await pool.query(incidentQuery, [id]);

    if (incidentResult.rows.length === 0) {
      const errorResponse = createNotFoundError('Incident', id);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    // Fetch post-mortem
    const postMortemQuery = `
      SELECT id, incident_id, status, summary, root_cause, impact_assessment, action_items, lessons, impact_duration_minutes, created_at, updated_at
      FROM post_mortems
      WHERE incident_id = $1
    `;
    const postMortemResult = await pool.query(postMortemQuery, [id]);

    if (postMortemResult.rows.length === 0) {
      const errorResponse = createNotFoundError('PostMortem', id);
      res.status(errorResponse.statusCode).json(errorResponse);
      return;
    }

    // Fetch timeline entries
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

    const row = postMortemResult.rows[0];
    const postMortem: PostMortem = {
      id: row.id,
      incidentId: row.incident_id,
      status: row.status,
      summary: row.summary,
      rootCause: row.root_cause,
      impactAssessment: row.impact_assessment,
      actionItems: row.action_items,
      lessons: row.lessons,
      timeline,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };

    res.status(200).json(postMortem);
  } catch (error) {
    console.error('Error retrieving post-mortem:', error);
    const errorResponse = createServiceUnavailableError('Failed to retrieve post-mortem');
    res.status(errorResponse.statusCode).json(errorResponse);
  }
});

export { router as postmortemRouter };
