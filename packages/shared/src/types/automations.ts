// -----------------------------------------------------------------------------
// 自動化 (Automation)
// -----------------------------------------------------------------------------

export type AutomationEventType =
  | "friend_add"
  | "tag_change"
  | "score_threshold"
  | "cv_fire"
  | "message_received"
  | "postback_received"
  | "calendar_booked"
  | "restaurant.reservation.created"
  | "restaurant.reservation.changed"
  | "restaurant.reservation.cancelled"
  | "restaurant.arrived"
  | "restaurant.arrival_undone"
  | "restaurant.departed"
  | "restaurant.departure_undone"
  | "restaurant.waitlist.invited"
  | "form_submitted"
  | "link_clicked"
  | "datetime"
  | "daily"
  | "weekly"
  | "ec.order.confirmed"
  | "ec.order.shipped"
  | "ec.subscription.upcoming"
  | "ec.subscription.payment_failed"
  | "ec.subscription.cancelled";

export interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu" | "notify_staff";
  params: Record<string, unknown>;
}

export interface Automation extends Partial<import('../style-api.js').StyleSampleMetadata> {
  id: string;
  name: string;
  description: string | null;
  eventType: AutomationEventType;
  conditions: Record<string, unknown>;
  actions: AutomationAction[];
  isActive: boolean;
  priority: number;
  // null = global automation (fires for every account, per event-bus.ts:149).
  // UUID = bound to that line_account_id. Surfaced so account-scoped UIs can
  // distinguish a rule that affects every account from one they own.
  lineAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: string;
  automationId: string;
  friendId: string | null;
  eventData: string | null;
  actionsResult: string | null;
  status: "success" | "partial" | "failed";
  createdAt: string;
}
