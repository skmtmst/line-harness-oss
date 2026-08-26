export const ANALYTICS_EVENT_TYPE_LIST = [
  'friend_add',
  'friend_unfollow',
  'message_received',
  'message_sent',
  'postback_received',
  'tag_change',
  'scenario_started',
  'scenario_completed',
  'form_submitted',
  'url_clicked',
  'site_event',
  'booking_confirmed',
  'booking_cancelled',
  'conversion_created',
  'conversion_approved',
  'conversion_rejected',
  'automation_completed',
  'ec.order.confirmed',
  'ec.order.shipped',
  'ec.subscription.upcoming',
  'ec.subscription.payment_failed',
  'ec.subscription.cancelled',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPE_LIST)[number];
export const ANALYTICS_EVENT_TYPES: ReadonlySet<string> = new Set(ANALYTICS_EVENT_TYPE_LIST);
