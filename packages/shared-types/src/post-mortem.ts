import { TimelineEntry } from './timeline.js';

export type PostMortemStatus = 'draft' | 'review' | 'published';
export type ActionItemPriority = 'high' | 'medium' | 'low';
export type ActionItemStatus = 'open' | 'in_progress' | 'done';

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  priority: ActionItemPriority;
  dueDate: string;
  status: ActionItemStatus;
}

export interface PostMortem {
  id: string;
  incidentId: string;
  status: PostMortemStatus;
  summary: string;
  rootCause: string;
  impactAssessment: {
    affectedServices: string[];
    durationMinutes: number;
  };
  actionItems: ActionItem[];
  lessons: string;
  timeline: TimelineEntry[];
  createdAt: string;
  updatedAt: string;
}
