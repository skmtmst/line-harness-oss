// ── 送信の冪等予約 ─────────────────────────────────────────────────────────
// Webhook・LINE通知などの外部副作用より前に予約行を確保し、同時送信の
// 片方だけが処理を進める。scope は(テナント・LINEアカウント・フォーム・
// 友だち・キー)。途中失敗は failed に残し、同じキーで再開する。

export type FormSubmitClaimStatus = 'in_progress' | 'failed' | 'completed';

export interface FormSubmitClaim {
  tenant_id: string;
  line_account_id: string;
  form_id: string;
  friend_id: string;
  idempotency_key: string;
  request_hash: string;
  status: FormSubmitClaimStatus;
  /** 終わった工程の名前の JSON 配列 */
  steps: string;
  /** 工程名→完了日時。旧記録の日時は不明。 */
  step_completed_at_json?: string;
  /** Webhook の結果の JSON。未実行は NULL */
  webhook: string | null;
  /** 確保済みの回答行の id。回答の保存前は NULL */
  submission_id: string | null;
  /** 処理中の所有者(試行ごとの UUID)。横取りの判定に使う */
  owner: string;
  /**
   * 楽観ロックの版。横取りのたびに +1 し、読み取った版と一致するとき
   * だけ所有者の書き換え・工程の記録を受け付ける(CAS)。
   */
  version: number;
  /**
   * 借りの世代番号。横取りのたびに +1 し、古い世代の試行が残した
   * 副作用を重ねない柵にする。
   */
  lease_generation: number;
  /** layout の効果ごとの集計({効果id: {attempted, succeeded, failed}})の JSON */
  effect_stats: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}
