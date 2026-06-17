import type {
  Severity,
  IncidentStatus,
  TimelineEntryType,
  NotificationChannel,
  RunbookStepType,
} from '@incident-hub/shared-types';

export const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
export const VALID_STATUSES: IncidentStatus[] = [
  'declared',
  'investigating',
  'mitigating',
  'resolved',
  'closed',
];
export const VALID_TIMELINE_ENTRY_TYPES: TimelineEntryType[] = [
  'detection',
  'action',
  'communication',
  'escalation',
  'resolution',
  'note',
];
export const VALID_NOTIFICATION_CHANNELS: NotificationChannel[] = ['slack', 'email', 'pagerduty'];
export const VALID_STEP_TYPES: RunbookStepType[] = ['manual', 'automated'];

export const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus | null> = {
  declared: 'investigating',
  investigating: 'mitigating',
  mitigating: 'resolved',
  resolved: 'closed',
  closed: null,
};

export function isValidSeverity(value: string): value is Severity {
  return VALID_SEVERITIES.includes(value as Severity);
}

export function isValidStatus(value: string): value is IncidentStatus {
  return VALID_STATUSES.includes(value as IncidentStatus);
}

export function isValidTimelineEntryType(value: string): value is TimelineEntryType {
  return VALID_TIMELINE_ENTRY_TYPES.includes(value as TimelineEntryType);
}

export function isValidNotificationChannel(value: string): value is NotificationChannel {
  return VALID_NOTIFICATION_CHANNELS.includes(value as NotificationChannel);
}

export function isValidStepType(value: string): value is RunbookStepType {
  return VALID_STEP_TYPES.includes(value as RunbookStepType);
}

export function isValidTransition(current: IncidentStatus, target: IncidentStatus): boolean {
  return VALID_TRANSITIONS[current] === target;
}

export function canEscalateSeverity(current: Severity, target: Severity): boolean {
  return SEVERITY_ORDER[target] > SEVERITY_ORDER[current];
}

export function isActiveStatus(status: IncidentStatus): boolean {
  return status === 'declared' || status === 'investigating' || status === 'mitigating';
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isWithinLength(value: string, maxLength: number): boolean {
  return value.length <= maxLength;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateRequired(
  fields: Record<string, unknown>,
  requiredFields: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of requiredFields) {
    const value = fields[field];
    if (value === undefined || value === null) {
      errors.push({ field, message: `${field} is required` });
    } else if (typeof value === 'string' && value.trim().length === 0) {
      errors.push({ field, message: `${field} must not be empty or whitespace-only` });
    }
  }
  return errors;
}
