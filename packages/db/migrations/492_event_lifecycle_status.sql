-- Migration 492: イベントの5つの状態（U-2）。
--
-- v6-29 §11-2 の「下書き・公開中・終了・中止・一時停止」を保存する状態。
-- いまある is_published だけでは「一時停止」「中止」が表せない。
-- 付け足しだけ。既存の列は触らない。
--
-- 使い分け:
-- - lifecycle_status が正本（画面の札・LIFF の公開可否の判定に使う）。
-- - is_published は旧来の口との互換のため両書きする
--   （published のとき 1、それ以外は 0）。
-- - 「満席」「申込が少ない」は保存しない。開催回・定員・日時からの
--   計算で札を出す（確定文書 U の決めごと）。
-- - 既存行は is_published から移す（公開済み=公開中、それ以外=下書き）。

ALTER TABLE events
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (lifecycle_status IN ('draft', 'published', 'paused', 'ended', 'cancelled'));

ALTER TABLE events ADD COLUMN lifecycle_changed_at TEXT;

ALTER TABLE events ADD COLUMN lifecycle_change_reason TEXT;

UPDATE events
   SET lifecycle_status = CASE WHEN is_published = 1 THEN 'published' ELSE 'draft' END,
       lifecycle_changed_at = updated_at
 WHERE lifecycle_changed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_lifecycle
  ON events (line_account_id, lifecycle_status);
