-- N-231 案1: 付与ルールの公開版(変更不能履歴)＋現在ポインタ＋受付時スナップショット。
-- 形は friend-add-rules / scenarios / forms の公開版に合わせる。
-- 公開後に受け付けたイベントだけ新版、公開前に queue 済みの未処理イベントは旧版。
-- 既存 ledger・残高は不変(過去行の再計算はしない)。

CREATE TABLE IF NOT EXISTS mileage_earning_rule_published_versions (
  id                      TEXT PRIMARY KEY,
  rule_id                 TEXT NOT NULL REFERENCES mileage_rules(id) ON DELETE CASCADE,
  version_number          INTEGER NOT NULL CHECK (version_number >= 0),
  content_json            TEXT NOT NULL CHECK (json_valid(content_json)),
  status                  TEXT NOT NULL DEFAULT 'published'
                          CHECK (status IN ('published', 'retired')),
  publish_idempotency_key TEXT,
  published_at            TEXT NOT NULL,
  published_by_staff_id   TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (rule_id, version_number),
  UNIQUE (rule_id, publish_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_mileage_earning_rule_published_versions_rule
  ON mileage_earning_rule_published_versions(rule_id, version_number);

-- 現在の公開版ポインタ。NULL は未公開(旧口で作ったまま公開していない)。
ALTER TABLE mileage_rules ADD COLUMN published_version_number INTEGER NULL;

-- 受付時点で固定した適用版 {rule_id: version_number} の集合。NULL は旧来互換で live 読み。
ALTER TABLE mileage_event_queue ADD COLUMN applied_published_snapshot TEXT NULL
  CHECK (applied_published_snapshot IS NULL OR json_valid(applied_published_snapshot));

-- 初期公開 v1 を現 live 内容から seed。conditions は JSON のまま埋める。
INSERT OR IGNORE INTO mileage_earning_rule_published_versions
  (id, rule_id, version_number, content_json, status, published_at, created_at)
SELECT 'seed-' || r.id, r.id, 1,
  json_object(
    'name', r.name,
    'event_type', r.event_type,
    'source', r.source,
    'amount', r.amount,
    'initial_status', r.initial_status,
    'conditions', CASE
      WHEN r.conditions IS NULL THEN NULL
      WHEN json_valid(r.conditions) THEN json(r.conditions)
      ELSE r.conditions
    END,
    'valid_from', r.valid_from,
    'valid_until', r.valid_until
  ),
  'published', datetime('now'), datetime('now')
FROM mileage_rules r
WHERE r.line_account_id IS NOT NULL;

UPDATE mileage_rules
   SET published_version_number = 1
 WHERE line_account_id IS NOT NULL
   AND published_version_number IS NULL;

-- 既存の未処理行は migration 時点の公開内容(v1)へ安全に補完する。
-- 持ち主不明の行は '{}' になり、旧来どおり全店共通ルールだけが当たる。
UPDATE mileage_event_queue
   SET applied_published_snapshot = (
     SELECT json_group_object(r.id, COALESCE(r.published_version_number, 0))
       FROM engagement_events ee
       JOIN friends f ON f.id = ee.actor_friend_id
       JOIN mileage_rules r ON r.line_account_id = f.line_account_id
      WHERE ee.id = mileage_event_queue.engagement_event_id
   )
 WHERE status IN ('pending', 'failed')
   AND applied_published_snapshot IS NULL;
