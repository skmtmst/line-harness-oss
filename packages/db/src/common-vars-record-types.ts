


export interface CommonVar {
  id: string;
  line_account_id: string | null;
  folder_id: string | null;
  name: string;
  var_key: string;
  type: string;
  value: string;
  memo: string;
  version: number;
  updated_by: string | null;
  archived_at: string | null;
  replacement_run_id: string | null;
  status: CommonVarStatus;
  stopped_at: string | null;
  expiry_notice_14_at: string | null;
  expiry_notice_3_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  fallback_value: string | null;
  expiry_behavior: CommonVarExpiryBehavior;
  created_at: string;
  updated_at: string;
  /** 一覧用。未反映の次回予約を一覧APIでまとめて返し、行ごとのAPI呼出を避ける。 */
  next_effective_from?: string | null;
  next_value?: string | null;
  pending_schedule_count?: number;
  /** 一覧用。現在・過去を含め、差し込まれている場所の合計。 */
  usage_count?: number;
  usage_by_kind?: Record<CommonVarUsageKind, number>;
}

export type CommonVarExpiryBehavior = 'stop' | 'fallback';

/**
 * 共通情報の状態（Q）。「期限切れ」は列に持たず、有効終了と現在時刻から
 * 表示のたびに計算する。止めた・下書きは差し込みに答えられない。
 */
export type CommonVarStatus = 'draft' | 'active' | 'stopped';

export type CommonVarUsageKind =
  | 'template'
  | 'broadcast'
  | 'scenario'
  | 'reminder'
  | 'auto_reply'
  | 'form'
  | 'automation'
  | 'friend_add'
  | 'common_action';
