-- 機能05 点検（N-054）: 購読が止まっている理由を残す。
--
-- 手動の停止・「この通を送ったら止める」・配信失敗を区別し、
-- 画面の「再開」と「失敗を再送」を出し分けるために使う。
-- 既存の行は NULL（理由不明）のまま残す。

ALTER TABLE friend_scenarios ADD COLUMN pause_reason TEXT;

-- 友だち単位の操作（停止・再開・移動・失敗再送）の確認キー台帳。
-- 同じキーの再送は残っている結果をそのまま返し、別の操作への
-- 使い回しは 409 にする。公開キー（scenario_publish_keys）と同じ考え方。
CREATE TABLE IF NOT EXISTS friend_scenario_op_keys (
  op_idempotency_key TEXT PRIMARY KEY,
  friend_scenario_id TEXT NOT NULL,
  op TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
