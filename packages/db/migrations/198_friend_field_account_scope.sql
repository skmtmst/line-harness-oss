-- 友だち情報欄の既存IDと値を壊さず、選択中のLINE公式アカウントへの所属を追加する。
--
-- 対応表に行が無い既存項目は、既定テナントの共通項目として互換読取する。
-- 新しく作る項目は、作成時に選択していたLINE公式アカウントへ所属させる。
CREATE TABLE IF NOT EXISTS friend_field_scopes (
  field_id         TEXT PRIMARY KEY REFERENCES friend_fields(id) ON DELETE CASCADE,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  line_account_id  TEXT REFERENCES line_accounts(id),
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friend_field_scopes_account
  ON friend_field_scopes(tenant_id, line_account_id);
