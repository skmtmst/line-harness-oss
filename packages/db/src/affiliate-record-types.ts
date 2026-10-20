
// =============================================================================
// Affiliates — Affiliate & Tracking System
// =============================================================================

export interface Affiliate {
  folder_id?: string | null;
  id: string;
  tenant_id: string;
  line_account_id: string | null;
  name: string;
  code: string;
  commission_rate: number;
  reward_mode?: 'none' | 'fixed' | 'rate' | null;
  is_active: number;
  created_at: string;
  friend_id: string | null;
  /** 連絡先。報酬の連絡に使う。NULL なら未登録 */
  email: string | null;
  /** 成果が確定するまでの保留日数。NULL なら即確定 */
  hold_days: number | null;
  /** 支払いサイクルの覚書。計算には使わない */
  payout_cycle: string | null;
  /** 成果が出たときに本人へ知らせるか */
  notify_on_conversion: number;
}
