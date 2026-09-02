-- 対応マークの既存行とIDは変更せず、所属だけを別表で追加する。
--
-- 対応表に行が無い既存マークは、アプリ側で既定テナントの共通マークとして
-- 読み取る。新しく作るマークだけ、選択中のLINE公式アカウントを記録する。
CREATE TABLE IF NOT EXISTS support_mark_scopes (
  mark_id         TEXT PRIMARY KEY REFERENCES support_marks(id),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT REFERENCES line_accounts(id),
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_mark_scopes_account
  ON support_mark_scopes(tenant_id, line_account_id);
