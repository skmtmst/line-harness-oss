-- V6 機能30: ログインユーザーの権限版と、認証・業務操作を横断する監査台帳。
ALTER TABLE staff_members
  ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS audit_events (
  id                 TEXT PRIMARY KEY,
  source_kind        TEXT,
  source_id          TEXT,
  tenant_id          TEXT NOT NULL,
  line_account_id    TEXT,
  category           TEXT NOT NULL CHECK (category IN ('auth', 'business')),
  actor_principal_id TEXT,
  actor_role         TEXT,
  action             TEXT NOT NULL,
  target_kind        TEXT,
  target_id          TEXT,
  result             TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  before_json        TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json         TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason             TEXT,
  request_trace_id   TEXT,
  ip_prefix          TEXT,
  device_family      TEXT,
  risk_level         TEXT NOT NULL DEFAULT 'normal'
                     CHECK (risk_level IN ('normal', 'suspicious', 'high')),
  retention_class    TEXT NOT NULL DEFAULT 'general'
                     CHECK (retention_class IN ('general', 'security', 'personal_data')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE SET NULL,
  UNIQUE (source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created
  ON audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_account_created
  ON audit_events (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created
  ON audit_events (actor_principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_created
  ON audit_events (action, created_at DESC);

-- 既存の認証記録は本文や生IPを移さず、検索に必要な安全な項目だけ束ねる。
INSERT OR IGNORE INTO audit_events (
  id, source_kind, source_id, tenant_id, category, actor_principal_id, actor_role,
  action, target_kind, target_id, result, device_family, risk_level,
  retention_class, created_at
)
SELECT
  lower(hex(randomblob(16))),
  'login_audit',
  la.id,
  COALESCE(sm.tenant_id, '00000000-0000-4000-8000-000000000001'),
  'auth',
  la.admin_user_id,
  CASE
    WHEN sm.access_level = 'read_only' THEN 'view_only'
    WHEN sm.role IN ('owner', 'admin') THEN 'administrator'
    WHEN sm.role = 'staff' THEN 'operations'
    ELSE NULL
  END,
  'auth.' || la.action,
  CASE WHEN la.screen IS NULL THEN NULL ELSE 'screen' END,
  la.screen,
  CASE WHEN lower(la.result) IN ('ok', 'success') THEN 'success' ELSE 'failed' END,
  CASE
    WHEN lower(COALESCE(la.user_agent, '')) LIKE '%mobile%' THEN 'mobile'
    WHEN la.user_agent IS NULL THEN NULL
    ELSE 'desktop'
  END,
  CASE WHEN la.action = 'fail' OR lower(la.result) NOT IN ('ok', 'success') THEN 'suspicious' ELSE 'normal' END,
  'security',
  la.created_at
FROM login_audit la
LEFT JOIN staff_members sm ON sm.id = la.admin_user_id;

-- 旧操作台帳のdetail_jsonには個人情報が入り得るため、変更前後は移さない。
INSERT OR IGNORE INTO audit_events (
  id, source_kind, source_id, tenant_id, category, actor_principal_id, actor_role,
  action, target_kind, target_id, result, retention_class, created_at
)
SELECT
  lower(hex(randomblob(16))),
  'operation_audit',
  oa.id,
  COALESCE(sm.tenant_id, '00000000-0000-4000-8000-000000000001'),
  'business',
  oa.actor_id,
  CASE
    WHEN sm.access_level = 'read_only' THEN 'view_only'
    WHEN sm.role IN ('owner', 'admin') THEN 'administrator'
    WHEN sm.role = 'staff' THEN 'operations'
    ELSE NULL
  END,
  'operation.' || oa.target_kind || '.' || oa.action,
  oa.target_kind,
  oa.target_id,
  'success',
  'general',
  oa.created_at
FROM operation_audit oa
LEFT JOIN staff_members sm ON sm.id = oa.actor_id;
