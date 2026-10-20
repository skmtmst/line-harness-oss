
/**
 * 統括から運営へのお問い合わせ（36-3）。
 * 店舗のお客様からの問い合わせ（support 受信箱）とは別の表。
 */

export const HQ_SUPPORT_KINDS = ['usage', 'bug', 'billing', 'feature', 'other'] as const;

export type HqSupportKind = (typeof HQ_SUPPORT_KINDS)[number];


export const HQ_SUPPORT_STATUSES = ['open', 'answered', 'closed'] as const;

export type HqSupportStatus = (typeof HQ_SUPPORT_STATUSES)[number];


export interface HqSupportRequest {
  id: string;
  tenant_id: string;
  staff_id: string | null;
  staff_name: string;
  staff_email: string | null;
  kind: HqSupportKind;
  subject: string;
  body: string;
  line_account_id: string | null;
  attachment_keys: string;
  status: HqSupportStatus;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
  // 運営コンソール向け（migration 421）
  ticket_no: number | null;
  stage: 'new' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  channel: 'admin' | 'line' | 'ops';
  subject_auto: number;
  assignee_staff_id: string | null;
  first_replied_at: string | null;
  last_message_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
}
