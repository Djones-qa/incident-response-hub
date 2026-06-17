export type IncidentEventType =
  | 'declared'
  | 'status_changed'
  | 'severity_changed'
  | 'responder_assigned';

export interface IncidentEvent {
  type: IncidentEventType;
  incidentId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
