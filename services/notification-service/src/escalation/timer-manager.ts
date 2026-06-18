import { redis } from '../redis.js';
import { deliverNotification } from '../delivery/index.js';
import type { EscalationPolicy } from '@incident-hub/shared-types';
import type { IncidentEvent } from '@incident-hub/shared-types';

/**
 * Redis keys:
 * - escalation:{incidentId} (Hash): policyId, currentLevel, lastStatusChangeAt, timerActive
 * - escalation-timers (Sorted Set): members are incidentId, scored by trigger timestamp (ms)
 */

const ESCALATION_HASH_PREFIX = 'escalation:';
const ESCALATION_TIMERS_KEY = 'escalation-timers';
const INCIDENT_EVENTS_STREAM = 'incident-events';
const CONSUMER_GROUP = 'notification-escalation-group';
const CONSUMER_NAME = 'escalation-consumer-1';

const INCIDENT_ENGINE_BASE_URL = process.env.INCIDENT_ENGINE_URL || `http://localhost:4000`;

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let streamPollingInterval: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Start the timer manager:
 * - Creates consumer group for incident-events stream
 * - Polls the stream for new events
 * - Polls sorted set for expired timers every 5 seconds
 */
export async function startTimerManager(): Promise<void> {
  if (running) return;
  running = true;

  // Ensure consumer group exists
  try {
    await redis.xgroup('CREATE', INCIDENT_EVENTS_STREAM, CONSUMER_GROUP, '0', 'MKSTREAM');
  } catch (err: any) {
    // Group already exists — safe to ignore
    if (!err.message?.includes('BUSYGROUP')) {
      console.error('Failed to create consumer group:', err);
    }
  }

  // Start stream consumer polling (every 2 seconds)
  streamPollingInterval = setInterval(consumeIncidentEvents, 2000);

  // Start timer expiry polling (every 5 seconds)
  pollingInterval = setInterval(checkExpiredTimers, 5000);

  console.log('Escalation timer manager started');
}

/**
 * Stop the timer manager and clean up intervals.
 */
export function stopTimerManager(): void {
  running = false;

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  if (streamPollingInterval) {
    clearInterval(streamPollingInterval);
    streamPollingInterval = null;
  }

  console.log('Escalation timer manager stopped');
}

/**
 * Consume events from the incident-events Redis Stream.
 */
async function consumeIncidentEvents(): Promise<void> {
  if (!running) return;

  try {
    const results = await redis.xreadgroup(
      'GROUP',
      CONSUMER_GROUP,
      CONSUMER_NAME,
      'COUNT',
      '10',
      'BLOCK',
      '1000',
      'STREAMS',
      INCIDENT_EVENTS_STREAM,
      '>'
    );

    if (!results || results.length === 0) return;

    const streams = results as Array<[string, Array<[string, string[]]>]>;
    for (const [, messages] of streams) {
      for (const [messageId, fields] of messages) {
        const event = parseStreamMessage(fields);
        if (event) {
          await handleIncidentEvent(event);
        }
        // Acknowledge the message
        await redis.xack(INCIDENT_EVENTS_STREAM, CONSUMER_GROUP, messageId);
      }
    }
  } catch (err: any) {
    if (running) {
      console.error('Error consuming incident events:', err.message);
    }
  }
}

/**
 * Parse Redis Stream message fields into an IncidentEvent.
 */
function parseStreamMessage(fields: string[]): IncidentEvent | null {
  try {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1];
    }

    if (obj.data) {
      return JSON.parse(obj.data) as IncidentEvent;
    }

    // Fallback: reconstruct from individual fields
    return {
      type: obj.type as IncidentEvent['type'],
      incidentId: obj.incidentId,
      timestamp: obj.timestamp,
      payload: obj.payload ? JSON.parse(obj.payload) : {},
    };
  } catch {
    return null;
  }
}

/**
 * Handle an incident event:
 * - declared: start escalation timers
 * - status_changed: cancel timers and reset sequence
 */
async function handleIncidentEvent(event: IncidentEvent): Promise<void> {
  switch (event.type) {
    case 'declared':
      await handleIncidentDeclared(event);
      break;
    case 'status_changed':
      await handleStatusChanged(event);
      break;
    default:
      // Other event types don't affect escalation timers
      break;
  }
}

/**
 * On incident declared: look up the first escalation policy and start the timer sequence.
 */
async function handleIncidentDeclared(event: IncidentEvent): Promise<void> {
  const { incidentId, timestamp } = event;

  // Look up the first available escalation policy from Redis
  const policy = await getFirstEscalationPolicy();
  if (!policy || policy.levels.length === 0) {
    return; // No policies configured — no escalation
  }

  const firstLevel = policy.levels[0];
  const triggerAt = new Date(timestamp).getTime() + firstLevel.notifyAfter * 60 * 1000;

  // Store escalation state
  await redis.hset(`${ESCALATION_HASH_PREFIX}${incidentId}`, {
    policyId: policy.id,
    currentLevel: '0',
    lastStatusChangeAt: timestamp,
    timerActive: 'true',
  });

  // Schedule the timer in the sorted set
  await redis.zadd(ESCALATION_TIMERS_KEY, triggerAt, incidentId);

  console.log(
    `Escalation timer started for incident ${incidentId}, level 0 triggers at ${new Date(triggerAt).toISOString()}`
  );
}

/**
 * On status change: cancel pending escalation timers and reset the sequence.
 */
async function handleStatusChanged(event: IncidentEvent): Promise<void> {
  const { incidentId } = event;

  // Remove escalation state
  await redis.del(`${ESCALATION_HASH_PREFIX}${incidentId}`);

  // Remove from timer sorted set
  await redis.zrem(ESCALATION_TIMERS_KEY, incidentId);

  console.log(`Escalation timers cancelled for incident ${incidentId} due to status change`);
}

/**
 * Check for expired timers and trigger escalation notifications.
 */
async function checkExpiredTimers(): Promise<void> {
  if (!running) return;

  const now = Date.now();

  try {
    // Get all timers that have expired (score <= now)
    const expired = await redis.zrangebyscore(ESCALATION_TIMERS_KEY, '-inf', now.toString());

    for (const incidentId of expired) {
      await triggerEscalation(incidentId);
    }
  } catch (err: any) {
    if (running) {
      console.error('Error checking expired timers:', err.message);
    }
  }
}

/**
 * Trigger escalation for an incident:
 * - Send notifications via all channels in the current level
 * - Create escalation timeline entry
 * - Advance to next level or stop if exhausted
 */
async function triggerEscalation(incidentId: string): Promise<void> {
  const stateKey = `${ESCALATION_HASH_PREFIX}${incidentId}`;

  // Get current escalation state
  const state = await redis.hgetall(stateKey);
  if (!state || !state.policyId || state.timerActive !== 'true') {
    // State was cleaned up — remove from timers
    await redis.zrem(ESCALATION_TIMERS_KEY, incidentId);
    return;
  }

  const currentLevel = parseInt(state.currentLevel, 10);
  const policy = await getEscalationPolicyById(state.policyId);

  if (!policy || currentLevel >= policy.levels.length) {
    // Policy not found or all levels exhausted — stop escalation
    await redis.hset(stateKey, 'timerActive', 'false');
    await redis.zrem(ESCALATION_TIMERS_KEY, incidentId);
    return;
  }

  const level = policy.levels[currentLevel];

  // Send notifications through all channels specified in this level
  const message = `[AUTO-ESCALATION] Incident ${incidentId} has not changed status. Escalation level ${currentLevel + 1} triggered.`;

  for (const channel of level.channels) {
    try {
      await deliverNotification(channel, level.targets, message);
    } catch (err: any) {
      console.error(`Failed to deliver ${channel} notification for escalation:`, err.message);
    }
  }

  // Create escalation timeline entry via HTTP callback to incident-engine
  await createEscalationTimelineEntry(incidentId, currentLevel);

  // Advance to next level
  const nextLevel = currentLevel + 1;

  if (nextLevel >= policy.levels.length) {
    // All levels exhausted — stop further escalation
    await redis.hset(stateKey, {
      currentLevel: nextLevel.toString(),
      timerActive: 'false',
    });
    await redis.zrem(ESCALATION_TIMERS_KEY, incidentId);
    console.log(`All escalation levels exhausted for incident ${incidentId}`);
  } else {
    // Schedule next level timer
    const lastStatusChangeAt = new Date(state.lastStatusChangeAt).getTime();
    const nextTriggerAt = lastStatusChangeAt + policy.levels[nextLevel].notifyAfter * 60 * 1000;

    await redis.hset(stateKey, 'currentLevel', nextLevel.toString());
    await redis.zadd(ESCALATION_TIMERS_KEY, nextTriggerAt, incidentId);
    console.log(
      `Escalation advanced to level ${nextLevel} for incident ${incidentId}, triggers at ${new Date(nextTriggerAt).toISOString()}`
    );
  }
}

/**
 * Create an "escalation" timeline entry on the incident via HTTP POST to incident-engine.
 */
async function createEscalationTimelineEntry(incidentId: string, level: number): Promise<void> {
  const url = `${INCIDENT_ENGINE_BASE_URL}/incidents/${incidentId}/timeline`;

  const body = {
    type: 'escalation',
    author: 'notification-service',
    content: `Auto-escalation triggered: level ${level + 1} activated due to no status change within threshold`,
    metadata: {
      escalationLevel: (level + 1).toString(),
      triggeredBy: 'auto-escalation-timer',
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(
        `Failed to create escalation timeline entry for incident ${incidentId}: ${response.status} ${response.statusText}`
      );
    }
  } catch (err: any) {
    console.error(`HTTP callback to incident-engine failed for incident ${incidentId}:`, err.message);
  }
}

/**
 * Look up the first available escalation policy stored in Redis.
 * Policies are stored as JSON strings under keys like "escalation-policy:{id}".
 */
async function getFirstEscalationPolicy(): Promise<EscalationPolicy | null> {
  try {
    const keys = await redis.keys('escalation-policy:*');
    if (keys.length === 0) return null;

    // Sort keys to get deterministic "first" policy
    keys.sort();
    const data = await redis.get(keys[0]);
    if (!data) return null;

    return JSON.parse(data) as EscalationPolicy;
  } catch {
    return null;
  }
}

/**
 * Look up an escalation policy by ID from Redis.
 */
async function getEscalationPolicyById(policyId: string): Promise<EscalationPolicy | null> {
  try {
    const data = await redis.get(`escalation-policy:${policyId}`);
    if (!data) return null;

    return JSON.parse(data) as EscalationPolicy;
  } catch {
    return null;
  }
}
