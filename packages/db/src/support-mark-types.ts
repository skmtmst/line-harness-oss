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
