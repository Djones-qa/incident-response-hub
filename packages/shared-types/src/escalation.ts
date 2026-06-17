import { NotificationChannel } from './notification.js';

export interface EscalationLevel {
  targets: string[];
  notifyAfter: number;
  channels: NotificationChannel[];
}

export interface EscalationPolicy {
  id: string;
  name: string;
  levels: EscalationLevel[];
  createdAt: string;
  updatedAt: string;
}

export interface EscalationPolicyRequest {
  name: string;
  levels: EscalationLevel[];
}
