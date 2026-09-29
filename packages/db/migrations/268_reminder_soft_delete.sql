-- V6 7-1-I: リマインダ削除後も送信済み履歴を監査記録として残す。
--
-- これまでは reminders を物理削除し、CASCADE で通知ステップ・登録・配信履歴まで
-- 消していた。画面の確認文と実データを一致させるため、一覧から隠す印へ切り替える。

ALTER TABLE reminders ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_reminders_visible_order
  ON reminders (line_account_id, display_order, created_at)
  WHERE deleted_at IS NULL;
