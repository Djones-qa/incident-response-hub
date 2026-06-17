import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { redis } from '../redis.js';
import { getDeliveryHandler } from '../delivery/index.js';
import type { NotificationChannel, Notification } from '@incident-hub/shared-types';

const router = Router();

const VALID_CHANNELS: NotificationChannel[] = ['slack', 'email', 'pagerduty'];

interface SendNotificationBody {
  channel?: string;
  recipients?: string[];
  message?: string;
  incidentId?: string;
}

/**
 * Validates a notification request body and returns validation errors if any.
 */
function validateNotificationRequest(body: SendNotificationBody): string[] {
  const errors: string[] = [];

  if (!body.channel) {
    errors.push('channel is required');
  } else if (!VALID_CHANNELS.includes(body.channel as NotificationChannel)) {
    errors.push(`channel must be one of: ${VALID_CHANNELS.join(', ')}`);
  }

  if (!body.recipients) {
    errors.push('recipients is required');
  } else if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    errors.push('recipients must be a non-empty array');
  }

  if (!body.message || (typeof body.message === 'string' && body.message.trim() === '')) {
    errors.push('message is required and must be non-empty');
  }

  if (!body.incidentId || (typeof body.incidentId === 'string' && body.incidentId.trim() === '')) {
    errors.push('incidentId is required');
  }

  return errors;
}

/**
 * Delivers a notification with retry logic (up to 3 attempts with exponential backoff).
 */
async function deliverWithRetry(
  notificationId: string,
  channel: NotificationChannel,
  recipients: string[],
  message: string
): Promise<{ status: 'delivered' | 'failed'; error: string | null; retryCount: number }> {
  const maxAttempts = 3;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const handler = getDeliveryHandler(channel);
      await handler(recipients, message);

      // Update retry count in Redis
      await redis.hset(`notification:${notificationId}`, 'retryCount', String(attempt - 1));

      return { status: 'delivered', error: null, retryCount: attempt - 1 };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      // Update retry count
      await redis.hset(`notification:${notificationId}`, 'retryCount', String(attempt));

      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s (capped at 8s)
        const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return { status: 'failed', error: lastError, retryCount: maxAttempts };
}

/**
 * POST /notifications
 * Send a notification through the specified channel.
 */
router.post('/notifications', async (req: Request, res: Response) => {
  const body = req.body as SendNotificationBody;
  const errors = validateNotificationRequest(body);

  if (errors.length > 0) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid notification request',
        details: { errors },
      },
      statusCode: 400,
    });
  }

  const channel = body.channel as NotificationChannel;
  const recipients = body.recipients as string[];
  const message = body.message as string;
  const incidentId = body.incidentId as string;

  const notificationId = uuidv4();
  const createdAt = new Date().toISOString();

  // Store notification as pending in Redis hash
  const notificationData: Record<string, string> = {
    id: notificationId,
    incidentId,
    channel,
    recipients: JSON.stringify(recipients),
    message,
    status: 'pending',
    error: '',
    retryCount: '0',
    createdAt,
  };

  await redis.hset(`notification:${notificationId}`, notificationData);

  // Add to incident's notification sorted set (scored by timestamp)
  await redis.zadd(
    `incident:${incidentId}:notifications`,
    Date.parse(createdAt),
    notificationId
  );

  // Attempt delivery with retry logic
  const result = await deliverWithRetry(notificationId, channel, recipients, message);

  // Update final status
  await redis.hset(`notification:${notificationId}`, 'status', result.status);
  if (result.error) {
    await redis.hset(`notification:${notificationId}`, 'error', result.error);
  }

  const notification: Notification = {
    id: notificationId,
    incidentId,
    channel,
    recipients,
    message,
    status: result.status,
    error: result.error,
    retryCount: result.retryCount,
    createdAt,
  };

  return res.status(201).json(notification);
});

/**
 * GET /incidents/:id/notifications
 * Returns all notifications for an incident ordered by timestamp ascending.
 */
router.get('/incidents/:id/notifications', async (req: Request, res: Response) => {
  const incidentId = req.params.id;

  // Get notification IDs from sorted set (ordered by timestamp ascending)
  const notificationIds = await redis.zrangebyscore(
    `incident:${incidentId}:notifications`,
    '-inf',
    '+inf'
  );

  if (notificationIds.length === 0) {
    return res.status(200).json([]);
  }

  // Fetch each notification from Redis hash
  const notifications: Notification[] = [];

  for (const nId of notificationIds) {
    const data = await redis.hgetall(`notification:${nId}`);
    if (data && data.id) {
      notifications.push({
        id: data.id,
        incidentId: data.incidentId,
        channel: data.channel as NotificationChannel,
        recipients: JSON.parse(data.recipients),
        message: data.message,
        status: data.status as Notification['status'],
        error: data.error || null,
        retryCount: parseInt(data.retryCount, 10),
        createdAt: data.createdAt,
      });
    }
  }

  return res.status(200).json(notifications);
});

export { router as notificationRoutes };
