-- V6オートメーションから参照する既存資源のLINEアカウント所属。
--
-- 既存行は所属を推測して書き換えない。V6実行器は NULL を許可せず、明示的に
-- 同じLINEアカウントへ所属する行だけを使用する。

ALTER TABLE tags ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);
ALTER TABLE templates ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);
ALTER TABLE outgoing_webhooks ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

CREATE INDEX IF NOT EXISTS idx_tags_line_account
  ON tags(line_account_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_templates_line_account
  ON templates(line_account_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_outgoing_webhooks_line_account
  ON outgoing_webhooks(line_account_id, is_active, updated_at DESC);
