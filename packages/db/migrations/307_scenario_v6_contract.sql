-- V6 機能5（migration 307）: シナリオ下書きの送信後アクションを、版競合を防いで保存する。
--
-- 現行の scenario_actions は配信エンジンが読む公開中設定のため、下書き保存で
-- 直接置き換えない。公開処理が入るまでは、この表を編集用の正本とする。
CREATE TABLE IF NOT EXISTS scenario_drafts (
  scenario_id        TEXT PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  line_account_id    TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  after_actions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(after_actions_json)),
  updated_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenario_drafts_account_updated
  ON scenario_drafts(line_account_id, updated_at DESC, scenario_id);
