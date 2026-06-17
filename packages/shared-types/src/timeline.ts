export type TimelineEntryType =
  | 'detection'
  | 'action'
  | 'communication'
  | 'escalation'
  | 'resolution'
  | 'note';

export interface TimelineEntry {
  id: string;
  incidentId: string;
  type: TimelineEntryType;
  author: string;
  content: string;
  metadata: Record<string, string> | null;
  createdAt: string;
}

export interface TimelineEntryRequest {
  type: TimelineEntryType;
  author: string;
  content: string;
  metadata?: Record<string, string>;
}
