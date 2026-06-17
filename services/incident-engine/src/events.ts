import type { IncidentEvent, NotificationRequest } from '@incident-hub/shared-types';
import { redis } from './redis.js';

/**
 * Publish an IncidentEvent to the `incident-events` Redis Stream.
 * Event is serialized as JSON in a single `data` field.
 */
export async function publishIncidentEvent(event: IncidentEvent): Promise<void> {
  try {
    const data = JSON.stringify(event);
    await redis.xadd('incident-events', '*', 'data', data);
  } catch (err) {
    console.error('Failed to publish incident event:', err);
  }
}

/**
 * Publish a NotificationRequest to the `stream:notifications` Redis Stream.
 * Request is serialized as JSON in a single `data` field.
 */
export async function publishNotificationRequest(request: NotificationRequest): Promise<void> {
  try {
    const data = JSON.stringify(request);
    await redis.xadd('stream:notifications', '*', 'data', data);
  } catch (err) {
    console.error('Failed to publish notification request:', err);
  }
}
