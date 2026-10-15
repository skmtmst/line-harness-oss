/**
 * 対応マーク。
 *
 * 受信箱の「未対応／対応中／解決済」は chats.status が持っているが、
 * あれは3つ固定でトークにしか付かない。マークは友だちに付き、
 * 名前も色も運用側が決められる。
 */

export interface SupportMark {
  id: string;
  name: string;
  color: string;
  is_default: number;
  auto_on_inbound: number;
  display_order: number;
  display_locations_json: string;
  created_at: string;
  archived_at: string | null;
  version: number;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  /** NULL は移行前からあるテナント共通マーク。 */
  line_account_id: string | null;
  tenant_id: string;
  is_inherited: number;
}

export interface SupportMarkWithUsage extends SupportMark {
  friend_count: number;
  broadcasts: number;
  scenarios: number;
  auto_replies: number;
  saved_searches: number;
  automations: number;
}

export function supportMarkImpactRevision(mark: SupportMarkWithUsage): string {
  return [
    mark.id,
    Number(mark.version ?? 1),
    Number(mark.friend_count),
    Number(mark.broadcasts),
    Number(mark.scenarios),
    Number(mark.auto_replies),
    Number(mark.saved_searches),
    Number(mark.automations),
  ].join(':');
}
