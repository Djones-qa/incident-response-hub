import { NotificationChannel } from '@incident-hub/shared-types';

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

export type DeliveryHandler = (recipients: string[], message: string) => Promise<void>;

export function getDeliveryHandler(channel: NotificationChannel): DeliveryHandler {
  switch (channel) {
    case 'slack':
      return async (recipients, message) => {
        console.log(`[Slack] Sending to ${recipients.join(', ')}: ${message}`);
      };
    case 'email':
      return async (recipients, message) => {
        console.log(`[Email] Sending to ${recipients.join(', ')}: ${message}`);
      };
    case 'pagerduty':
      return async (recipients, message) => {
        console.log(`[PagerDuty] Sending to ${recipients.join(', ')}: ${message}`);
      };
    default:
      throw new Error(`Unknown channel: ${channel}`);
  }
}

export async function deliverNotification(
  channel: NotificationChannel,
  recipients: string[],
  message: string
): Promise<DeliveryResult> {
  switch (channel) {
    case 'slack':
      return deliverSlack(recipients, message);
    case 'email':
      return deliverEmail(recipients, message);
    case 'pagerduty':
      return deliverPagerDuty(recipients, message);
    default:
      return { success: false, error: `Unknown channel: ${channel}` };
  }
}

async function deliverSlack(recipients: string[], message: string): Promise<DeliveryResult> {
  // Stub implementation — in production this would call Slack API
  console.log(`[Slack] Sending to ${recipients.join(', ')}: ${message}`);
  return { success: true };
}

async function deliverEmail(recipients: string[], message: string): Promise<DeliveryResult> {
  // Stub implementation — in production this would send via SMTP/SES
  console.log(`[Email] Sending to ${recipients.join(', ')}: ${message}`);
  return { success: true };
}

async function deliverPagerDuty(recipients: string[], message: string): Promise<DeliveryResult> {
  // Stub implementation — in production this would call PagerDuty API
  console.log(`[PagerDuty] Sending to ${recipients.join(', ')}: ${message}`);
  return { success: true };
}
