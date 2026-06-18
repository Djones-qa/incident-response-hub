import { v4 as uuidv4 } from 'uuid';
import { redis } from './redis.js';
import { getDeliveryHandler } from './delivery/index.js';
import type { NotificationChannel, Notification } from '@incident-hub/shared-types';

const STREAM_KEY = 'stream:notifications';
const GROUP_NAME = 'notification-service-group';
const CONSUMER_NAME = `consumer-${process.pid}`;

/**
 * Ensures the consumer group exists for the notifications stream.
 */
async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
  } catch (err: unknown) {
    // Group already exists — ignore BUSYGROUP error
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      return;
    }
    throw err;
  }
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
      return { status: 'delivered', error: null, retryCount: attempt - 1 };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

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
 * Processes a single notification message from the stream.
 */
async function processMessage(fields: Record<string, string>): Promise<void> {
  const channel = fields.channel as NotificationChannel;
  const recipients = JSON.parse(fields.recipients || '[]') as string[];
  const message = fields.message || '';
  const incidentId = fields.incidentId || '';

  if (!channel || recipients.length === 0 || !message || !incidentId) {
    console.error('[StreamConsumer] Invalid notification message, skipping:', fields);
    return;
  }

  const notificationId = uuidv4();
  const createdAt = new Date().toISOString();

  // Store notification as pending
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

  // Add to incident's sorted set
  await redis.zadd(
    `incident:${incidentId}:notifications`,
    Date.parse(createdAt),
    notificationId
  );

  // Attempt delivery
  const result = await deliverWithRetry(notificationId, channel, recipients, message);

  // Update final status
  await redis.hset(`notification:${notificationId}`, 'status', result.status);
  await redis.hset(`notification:${notificationId}`, 'retryCount', String(result.retryCount));
  if (result.error) {
    await redis.hset(`notification:${notificationId}`, 'error', result.error);
  }

  console.log(
    `[StreamConsumer] Notification ${notificationId} for incident ${incidentId}: ${result.status}`
  );
}

/**
 * Starts the stream consumer loop.
 * Reads from Redis Stream `stream:notifications` using XREADGROUP.
 */
export async function startStreamConsumer(): Promise<void> {
  await ensureConsumerGroup();

  console.log('[StreamConsumer] Started consuming from stream:notifications');

  // Continuously read new messages
  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP',
        GROUP_NAME,
        CONSUMER_NAME,
        'COUNT',
        '10',
        'BLOCK',
        '5000',
        'STREAMS',
        STREAM_KEY,
        '>'
      );

      if (!results || results.length === 0) {
        continue;
      }

      const streams = results as Array<[string, Array<[string, string[]]>]>;
      for (const [_stream, messages] of streams) {
        for (const [messageId, fieldArray] of messages) {
          // Convert field array to object
          const fields: Record<string, string> = {};
          for (let i = 0; i < fieldArray.length; i += 2) {
            fields[fieldArray[i]] = fieldArray[i + 1];
          }

          try {
            await processMessage(fields);
            // Acknowledge the message
            await redis.xack(STREAM_KEY, GROUP_NAME, messageId);
          } catch (err) {
            console.error(
              `[StreamConsumer] Error processing message ${messageId}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }
    } catch (err) {
      // If Redis connection is lost, wait and retry
      console.error(
        '[StreamConsumer] Error reading from stream:',
        err instanceof Error ? err.message : err
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
