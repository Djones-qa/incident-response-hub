import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { redis } from '../redis.js';
import type {
  EscalationPolicy,
  EscalationLevel,
  NotificationChannel,
} from '@incident-hub/shared-types';

const router = Router();

const VALID_CHANNELS: NotificationChannel[] = ['slack', 'email', 'pagerduty'];

interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function validateEscalationPolicyRequest(body: unknown): ValidationError | null {
  if (!body || typeof body !== 'object') {
    return { code: 'VALIDATION_ERROR', message: 'Request body is required' };
  }

  const { name, levels } = body as Record<string, unknown>;

  // Validate name
  if (name === undefined || name === null) {
    return { code: 'VALIDATION_ERROR', message: 'name is required' };
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { code: 'VALIDATION_ERROR', message: 'name must be a non-empty string' };
  }
  if (name.length < 1 || name.length > 200) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'name must be between 1 and 200 characters',
    };
  }

  // Validate levels array
  if (!Array.isArray(levels)) {
    return { code: 'VALIDATION_ERROR', message: 'levels must be an array' };
  }
  if (levels.length < 1 || levels.length > 10) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'levels must have between 1 and 10 entries',
    };
  }

  // Validate each level
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (!level || typeof level !== 'object') {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}] must be an object`,
      };
    }

    const { targets, notifyAfter, channels } = level as Record<string, unknown>;

    // Validate targets
    if (!Array.isArray(targets) || targets.length < 1) {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}].targets must be a non-empty array`,
      };
    }
    for (let j = 0; j < targets.length; j++) {
      if (typeof targets[j] !== 'string' || (targets[j] as string).trim().length === 0) {
        return {
          code: 'VALIDATION_ERROR',
          message: `levels[${i}].targets[${j}] must be a non-empty string`,
        };
      }
    }

    // Validate notifyAfter
    if (notifyAfter === undefined || notifyAfter === null) {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}].notifyAfter is required`,
      };
    }
    if (typeof notifyAfter !== 'number' || !Number.isInteger(notifyAfter)) {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}].notifyAfter must be an integer`,
      };
    }
    if (notifyAfter < 1 || notifyAfter > 1440) {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}].notifyAfter must be between 1 and 1440 minutes`,
      };
    }

    // Validate channels
    if (!Array.isArray(channels) || channels.length < 1) {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}].channels must be a non-empty array`,
      };
    }
    for (let j = 0; j < channels.length; j++) {
      if (!VALID_CHANNELS.includes(channels[j] as NotificationChannel)) {
        return {
          code: 'VALIDATION_ERROR',
          message: `levels[${i}].channels[${j}] must be one of: slack, email, pagerduty`,
        };
      }
    }
  }

  // Validate strictly increasing notifyAfter values
  for (let i = 1; i < levels.length; i++) {
    const prev = (levels[i - 1] as Record<string, unknown>).notifyAfter as number;
    const curr = (levels[i] as Record<string, unknown>).notifyAfter as number;
    if (curr <= prev) {
      return {
        code: 'VALIDATION_ERROR',
        message: `levels[${i}].notifyAfter (${curr}) must be greater than levels[${i - 1}].notifyAfter (${prev})`,
        details: { levelIndex: i, currentValue: curr, previousValue: prev },
      };
    }
  }

  return null;
}

// POST /escalation-policies
router.post('/', async (req: Request, res: Response) => {
  const validationError = validateEscalationPolicyRequest(req.body);
  if (validationError) {
    return res.status(400).json({
      error: validationError,
      statusCode: 400,
    });
  }

  const { name, levels } = req.body as { name: string; levels: EscalationLevel[] };
  const now = new Date().toISOString();

  const policy: EscalationPolicy = {
    id: uuidv4(),
    name,
    levels,
    createdAt: now,
    updatedAt: now,
  };

  // Store policy in Redis hash and sorted set
  await redis.set(`escalation-policy:${policy.id}`, JSON.stringify(policy));
  await redis.zadd('escalation-policies', Date.now().toString(), policy.id);

  return res.status(201).json(policy);
});

// GET /escalation-policies
router.get('/', async (_req: Request, res: Response) => {
  const policyIds = await redis.zrange('escalation-policies', 0, -1);

  if (policyIds.length === 0) {
    return res.status(200).json([]);
  }

  const pipeline = redis.pipeline();
  for (const id of policyIds) {
    pipeline.get(`escalation-policy:${id}`);
  }
  const results = await pipeline.exec();

  const policies: EscalationPolicy[] = [];
  if (results) {
    for (const [err, data] of results) {
      if (!err && data) {
        policies.push(JSON.parse(data as string) as EscalationPolicy);
      }
    }
  }

  return res.status(200).json(policies);
});

// GET /escalation-policies/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const data = await redis.get(`escalation-policy:${id}`);
  if (!data) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Escalation policy with id '${id}' not found`,
      },
      statusCode: 404,
    });
  }

  const policy = JSON.parse(data) as EscalationPolicy;
  return res.status(200).json(policy);
});

export { router as escalationPoliciesRouter };
