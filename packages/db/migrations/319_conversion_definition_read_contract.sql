-- 機能19: 成果地点の読取契約と、構造化された利用先台帳。
--
-- 既存の conversion_points / conversion_events を引き続き正本にする。
-- 利用先を名前・URL・JSONの全文検索で推測せず、成果地点の版と一緒に記録する。

ALTER TABLE conversion_points ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0);

CREATE TABLE IF NOT EXISTS conversion_definition_usages (
  id                       TEXT PRIMARY KEY,
  conversion_point_id      TEXT NOT NULL REFERENCES conversion_points(id),
  definition_version       INTEGER NOT NULL CHECK (definition_version > 0),
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id),
  ref_kind                 TEXT NOT NULL CHECK (ref_kind IN (
    'affiliate_offer', 'analytics', 'auto_reply', 'scenario', 'nen_campaign',
    'mileage_rule', 'automation', 'ad_platform'
  )),
  ref_id                   TEXT NOT NULL,
  ref_version_id           TEXT,
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_definition_usages_reference
  ON conversion_definition_usages(
    conversion_point_id,
    line_account_id,
    ref_kind,
    ref_id,
    COALESCE(ref_version_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_conversion_definition_usages_point
  ON conversion_definition_usages(conversion_point_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversion_definition_usages_account
  ON conversion_definition_usages(line_account_id, ref_kind, ref_id);
