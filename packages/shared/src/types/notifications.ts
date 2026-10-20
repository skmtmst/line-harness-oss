// -----------------------------------------------------------------------------
// 通知ルール (NotificationRule)
// -----------------------------------------------------------------------------

export interface NotificationRule {
  version?: number;
  id: string;
  name: string;
  eventType: string;
  conditions: Record<string, unknown>;
  channels: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  ruleId: string | null;
  eventType: string;
  title: string;
  body: string;
  channel: string;
  status: "pending" | "sent" | "failed";
  metadata: string | null;
  createdAt: string;
}

export type NotificationCenterCategory = "error" | "update" | "info";

export interface NotificationCenterItem {
  id: string;
  eventType: string;
  category: NotificationCenterCategory;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationCenterData {
  items: NotificationCenterItem[];
  counts: {
    all: number;
    error: number;
    update: number;
    unread: number;
  };
  unreadCount: number;
}

export interface OperatorNotificationTeam {
  id: string;
  lineAccountId: string;
  name: string;
  staffIds: string[];
  version: number;
  archivedAt: string | null;
}
