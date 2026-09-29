-- 運営（musubo 提供元）の階層。★V6 37 マスター（運営）コンソール。
--
-- これまで「統括を管理できる人」は、既定の統括に所属するオーナーとみなしていた
-- （apps/worker/src/routes/tenants.ts の canManageTenants）。運営の権限が顧客の
-- 統括と同じ器に入っているため、監査で運営の操作と顧客の操作を分けられない。
--
-- ここでは運営の権限を staff_members への参照として別表に持つ。ログイン・2要素
-- 認証・LINE ログインは既存の staff_members の仕組みをそのまま使い、
-- 「運営マスターかどうか」だけをこの表で判定する。

CREATE TABLE IF NOT EXISTS platform_admins (
  staff_id      TEXT PRIMARY KEY REFERENCES staff_members(id) ON DELETE CASCADE,
  is_active     INTEGER NOT NULL DEFAULT 1,
  -- 追加を承認した運営マスター（要件 §3 37-10。最初の 3 名は移行時に NULL）。
  approved_by   TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 運営が行った操作の記録。誰が・いつ・どの契約先に・何を・なぜ。
-- visible_to_tenant が 1 のものだけを契約先の画面に見せる（書き込みを伴う操作）。
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id                 TEXT PRIMARY KEY,
  staff_id           TEXT NOT NULL,
  staff_name         TEXT NOT NULL DEFAULT '',
  tenant_id          TEXT,
  tenant_name        TEXT,
  action             TEXT NOT NULL,
  reason             TEXT,
  detail             TEXT NOT NULL DEFAULT '{}',
  ip                 TEXT,
  visible_to_tenant  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created
  ON platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_tenant
  ON platform_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_action
  ON platform_audit_logs(action, created_at DESC);

-- 代理ログイン。運営マスター 1 人につき、有効なものは同時に 1 件だけ。
-- 既定は閲覧のみ（mode='read'）。書き込みは理由を入れて切り替える。
-- 時間制限は設けない（要件 §3 37-5）。終了は ended_at を入れる。
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id             TEXT PRIMARY KEY,
  staff_id       TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'read' CHECK (mode IN ('read', 'write')),
  write_reason   TEXT,
  -- 個人情報の一時表示。理由を入れると 1 になり、終了で戻る。
  pii_revealed   INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  write_started_at TEXT,
  ended_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_active
  ON impersonation_sessions(staff_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_tenant
  ON impersonation_sessions(tenant_id, started_at DESC);

-- 個人情報を表示した記録。誰が・いつ・どの契約先で・なぜ。
CREATE TABLE IF NOT EXISTS pii_reveal_logs (
  id                        TEXT PRIMARY KEY,
  impersonation_session_id  TEXT NOT NULL REFERENCES impersonation_sessions(id) ON DELETE CASCADE,
  staff_id                  TEXT NOT NULL,
  tenant_id                 TEXT NOT NULL,
  reason                    TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_pii_reveal_logs_tenant
  ON pii_reveal_logs(tenant_id, created_at DESC);
