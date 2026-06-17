import * as fc from 'fast-check';
import type {
  Severity,
  IncidentStatus,
  Incident,
  TimelineEntryType,
  TimelineEntry,
  Runbook,
  RunbookStep,
  RunbookStepType,
  TriggerCondition,
  EscalationPolicy,
  EscalationLevel,
  NotificationChannel,
} from '@incident-hub/shared-types';

// --- Primitive generators ---

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: IncidentStatus[] = ['declared', 'investigating', 'mitigating', 'resolved', 'closed'];
const TIMELINE_ENTRY_TYPES: TimelineEntryType[] = ['detection', 'action', 'communication', 'escalation', 'resolution', 'note'];
const TRIGGER_OPERATORS = ['equals', 'contains', 'gt', 'lt'] as const;
const NOTIFICATION_CHANNELS: NotificationChannel[] = ['slack', 'email', 'pagerduty'];

/**
 * Generates a random severity level.
 */
export function arbitrarySeverity(): fc.Arbitrary<Severity> {
  return fc.constantFrom(...SEVERITIES);
}

/**
 * Generates a random incident status.
 */
export function arbitraryStatus(): fc.Arbitrary<IncidentStatus> {
  return fc.constantFrom(...STATUSES);
}

// --- Helper generators ---

function arbitraryUUID(): fc.Arbitrary<string> {
  return fc.uuid();
}

function arbitraryISOTimestamp(): fc.Arbitrary<string> {
  return fc.date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  }).map((d) => d.toISOString());
}

function arbitraryNonEmptyString(maxLength: number): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);
}

// --- Incident generator ---

/**
 * Generates a valid incident with all field constraints:
 * - title: non-empty, max 200 chars
 * - description: non-empty, max 5000 chars
 * - severity: valid value
 * - affectedServices: at least one entry
 * - status: valid value
 * - UUIDs for id
 * - ISO timestamps
 */
export function arbitraryIncident(): fc.Arbitrary<Incident> {
  return fc.record({
    id: arbitraryUUID(),
    title: arbitraryNonEmptyString(200),
    description: arbitraryNonEmptyString(5000),
    severity: arbitrarySeverity(),
    status: arbitraryStatus(),
    affectedServices: fc.array(arbitraryNonEmptyString(100), { minLength: 1, maxLength: 10 }),
    assignedResponders: fc.array(arbitraryUUID(), { minLength: 0, maxLength: 20 }),
    declaredAt: arbitraryISOTimestamp(),
    createdAt: arbitraryISOTimestamp(),
    resolvedAt: fc.option(arbitraryISOTimestamp(), { nil: null }),
    closedAt: fc.option(arbitraryISOTimestamp(), { nil: null }),
    updatedAt: arbitraryISOTimestamp(),
  }).map((incident) => {
    // Ensure timestamp consistency: declaredAt === createdAt
    const base = { ...incident, createdAt: incident.declaredAt };

    // Ensure resolvedAt/closedAt consistency with status
    if (base.status === 'resolved' || base.status === 'closed') {
      base.resolvedAt = base.resolvedAt ?? new Date(
        new Date(base.declaredAt).getTime() + 3600000
      ).toISOString();
    } else {
      base.resolvedAt = null;
    }

    if (base.status === 'closed') {
      base.closedAt = base.closedAt ?? new Date(
        new Date(base.resolvedAt!).getTime() + 1800000
      ).toISOString();
    } else {
      base.closedAt = null;
    }

    return base;
  });
}

// --- Timeline Entry generator ---

/**
 * Generates a valid timeline entry:
 * - type: valid TimelineEntryType
 * - author: non-empty, max 200 chars
 * - content: non-empty, max 5000 chars
 * - metadata: optional, max 20 keys, key max 100 chars, value max 500 chars
 */
export function arbitraryTimelineEntry(): fc.Arbitrary<TimelineEntry> {
  const arbitraryMetadata: fc.Arbitrary<Record<string, string> | null> = fc.option(
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
      fc.string({ minLength: 0, maxLength: 500 }),
      { minKeys: 0, maxKeys: 20 }
    ),
    { nil: null }
  );

  return fc.record({
    id: arbitraryUUID(),
    incidentId: arbitraryUUID(),
    type: fc.constantFrom<TimelineEntryType>(...TIMELINE_ENTRY_TYPES),
    author: arbitraryNonEmptyString(200),
    content: arbitraryNonEmptyString(5000),
    metadata: arbitraryMetadata,
    createdAt: arbitraryISOTimestamp(),
  });
}

// --- Runbook generators ---

function arbitraryRunbookStep(order: number): fc.Arbitrary<RunbookStep> {
  return fc.record({
    order: fc.constant(order),
    name: arbitraryNonEmptyString(200),
    type: fc.constantFrom<RunbookStepType>('manual', 'automated'),
    expectedOutcome: arbitraryNonEmptyString(500),
    timeout: fc.integer({ min: 1, max: 86400 }),
    retries: fc.integer({ min: 0, max: 10 }),
  }).chain((step) => {
    // automated steps require a non-empty command
    if (step.type === 'automated') {
      return arbitraryNonEmptyString(1000).map((cmd) => ({ ...step, command: cmd }));
    }
    return fc.constant(step);
  });
}

/**
 * Generates a valid runbook:
 * - Unique step orders
 * - name, type (manual/automated), expectedOutcome, timeout (positive int), retries (0-10)
 * - command required for automated steps
 */
export function arbitraryRunbook(): fc.Arbitrary<Runbook> {
  const stepCount = fc.integer({ min: 1, max: 10 });

  return stepCount.chain((count) => {
    const steps = fc.tuple(
      ...Array.from({ length: count }, (_, i) => arbitraryRunbookStep(i + 1))
    );
    const rollbackCount = fc.integer({ min: 0, max: Math.min(count, 5) });

    return fc.record({
      id: arbitraryUUID(),
      name: arbitraryNonEmptyString(200),
      description: arbitraryNonEmptyString(2000),
      triggerConditions: fc.array(arbitraryTriggerCondition(), { minLength: 1, maxLength: 5 }),
      steps: steps as unknown as fc.Arbitrary<RunbookStep[]>,
      rollbackSteps: rollbackCount.chain((rc) =>
        fc.tuple(
          ...Array.from({ length: rc }, (_, i) => arbitraryRunbookStep(i + 1))
        ) as unknown as fc.Arbitrary<RunbookStep[]>
      ),
      createdAt: arbitraryISOTimestamp(),
      updatedAt: arbitraryISOTimestamp(),
    });
  });
}

// --- Trigger Condition generator ---

/**
 * Generates a trigger condition:
 * - field name (non-empty string)
 * - operator from ['equals', 'contains', 'gt', 'lt']
 * - value (string)
 */
export function arbitraryTriggerCondition(): fc.Arbitrary<TriggerCondition> {
  return fc.record({
    field: fc.constantFrom('severity', 'status', 'title', 'description', 'affectedServices'),
    operator: fc.constantFrom(...TRIGGER_OPERATORS),
    value: arbitraryNonEmptyString(200),
  });
}

// --- Escalation Policy generator ---

/**
 * Generates a valid escalation policy:
 * - name: 1-200 chars
 * - levels: 1-10 levels with strictly increasing notifyAfter (1-1440 minutes)
 * - targets, channels per level
 */
export function arbitraryEscalationPolicy(): fc.Arbitrary<EscalationPolicy> {
  const levelCount = fc.integer({ min: 1, max: 10 });

  return levelCount.chain((count) => {
    // Generate strictly increasing notifyAfter values
    return fc.array(
      fc.integer({ min: 1, max: 100 }),
      { minLength: count, maxLength: count }
    ).map((increments) => {
      // Convert increments to strictly increasing notifyAfter values
      let cumulative = 0;
      const notifyAfterValues: number[] = [];
      for (const inc of increments) {
        cumulative += inc;
        if (cumulative > 1440) cumulative = 1440;
        notifyAfterValues.push(cumulative);
      }
      return notifyAfterValues;
    }).chain((notifyAfterValues) => {
      const levels: fc.Arbitrary<EscalationLevel>[] = notifyAfterValues.map((notifyAfter) =>
        fc.record({
          targets: fc.array(arbitraryNonEmptyString(100), { minLength: 1, maxLength: 5 }),
          notifyAfter: fc.constant(notifyAfter),
          channels: fc.uniqueArray(
            fc.constantFrom<NotificationChannel>(...NOTIFICATION_CHANNELS),
            { minLength: 1, maxLength: 3 }
          ),
        })
      );

      return fc.record({
        id: arbitraryUUID(),
        name: arbitraryNonEmptyString(200),
        levels: fc.tuple(...levels) as unknown as fc.Arbitrary<EscalationLevel[]>,
        createdAt: arbitraryISOTimestamp(),
        updatedAt: arbitraryISOTimestamp(),
      });
    });
  });
}

// --- Status Transition Sequence generator ---

const VALID_TRANSITIONS: Array<[IncidentStatus, IncidentStatus]> = [
  ['declared', 'investigating'],
  ['investigating', 'mitigating'],
  ['mitigating', 'resolved'],
  ['resolved', 'closed'],
];

const ALL_TRANSITIONS: Array<[IncidentStatus, IncidentStatus]> = [];
for (const from of STATUSES) {
  for (const to of STATUSES) {
    if (from !== to) {
      ALL_TRANSITIONS.push([from, to]);
    }
  }
}

export interface StatusTransition {
  from: IncidentStatus;
  to: IncidentStatus;
  isValid: boolean;
}

/**
 * Generates sequences of valid and/or invalid status transitions.
 * Each entry includes whether the transition is valid per the state machine.
 */
export function arbitraryStatusTransitionSequence(): fc.Arbitrary<StatusTransition[]> {
  return fc.array(
    fc.constantFrom(...ALL_TRANSITIONS).map(([from, to]) => ({
      from,
      to,
      isValid: VALID_TRANSITIONS.some(([vf, vt]) => vf === from && vt === to),
    })),
    { minLength: 1, maxLength: 20 }
  );
}

/**
 * Generates a valid forward-only status transition sequence starting from 'declared'.
 * Useful for testing full lifecycle scenarios.
 */
export function arbitraryValidTransitionSequence(): fc.Arbitrary<StatusTransition[]> {
  return fc.integer({ min: 1, max: 4 }).map((length) => {
    const sequence: StatusTransition[] = [];
    for (let i = 0; i < length; i++) {
      sequence.push({
        from: VALID_TRANSITIONS[i][0],
        to: VALID_TRANSITIONS[i][1],
        isValid: true,
      });
    }
    return sequence;
  });
}
