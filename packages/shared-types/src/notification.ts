export type NotificationChannel = 'slack' | 'email' | 'pagerduty';
export type NotificationStatus = 'pending' | 'delivered' | 'failed';

export interface Notification {
  id: string;
  incidentId: string;
  channel: NotificationChannel;
  recipients: string[];
  message: string;
  status: NotificationStatus;
  error: string | null;
  retryCount: number;
  createdAt: string;
}

export interface NotificationRequest {
  channel: NotificationChannel;
  recipients: string[];
  message: string;
  incidentId: string;
}
