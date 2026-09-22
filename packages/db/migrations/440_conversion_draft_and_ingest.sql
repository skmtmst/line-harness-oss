-- migration-policy: table-rebuild
-- Issue #937 (N-268 / N-270): 成果地点の「下書き」状態と外部受信の基盤。
--
-- 1) status CHECK に 'draft' を足す。下書きは計測に乗らない保存だけの状態で、
--    status='active' を見る計測経路(recordConversionSourceEvent /
--    getUrlReachConversionPoints / ingest)はそのまま全て除外される。
-- 2) ingest_secret_encrypted / ingest_disabled_at を足す。外部システムからの
--    成果受信は地点ごとの secret を HMAC-SHA256 で照合する。鍵の暗号化は
--    受信Webhookと同じ credential-crypto 形式(k<鍵ID>.v1.<iv>.<暗号文>)を使う。
-- 3) conversion_ingestion_events: 受信の成否を残す台帳。署名が壊れた受信や
--    存在しない地点への受信も残すため conversion_point_id へFKは張らない。
--    署名そのものと本文は残さず、SHA-256 とマスク済みの形だけを残す。
--
-- DROP TABLE は中身の暗黙 DELETE として ON DELETE CASCADE を発火する
-- (sqlite3 で実測済み)。conversion_events / conversion_event_dedup_claims /
-- conversion_definition_revisions は CASCADE の子なので、先に退避してから
-- 戻す。conversion_definition_usages は NO ACTION の子で、行は触らず
-- コミット時の遅延検査に委ねる。

PRAGMA defer_foreign_keys = ON;

-- conversion_points を参照している外部キーは次の4表だけと確認済み。
-- ここに無い参照が増えていたら移行を止める。
-- D1 は pragma_foreign_key_list() のようなテーブル値関数形式の PRAGMA を
-- SQLITE_AUTH で拒否するため、sqlite_schema のテキストで参照列と削除動作を
-- 確認する。列名を含めて LIKE することで想定外の列・動作の混入も止める。
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'conversion_events' AND lower(sql) LIKE '%conversion_point_id%references conversion_points%on delete cascade%') THEN '{}' ELSE 'unexpected conversion_points foreign key: conversion_events' END);
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'conversion_event_dedup_claims' AND lower(sql) LIKE '%conversion_point_id%references conversion_points%on delete cascade%') THEN '{}' ELSE 'unexpected conversion_points foreign key: conversion_event_dedup_claims' END);
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'conversion_definition_usages' AND lower(sql) LIKE '%conversion_point_id%references conversion_points%' AND lower(sql) NOT LIKE '%references conversion_points%on delete%') THEN '{}' ELSE 'unexpected conversion_points foreign key: conversion_definition_usages' END);
SELECT json(CASE WHEN EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'conversion_definition_revisions' AND lower(sql) LIKE '%conversion_point_id%references conversion_points%on delete cascade%') THEN '{}' ELSE 'unexpected conversion_points foreign key: conversion_definition_revisions' END);
SELECT json(CASE WHEN (
 SELECT COALESCE(SUM(
   (length(lower(sql)) - length(replace(lower(sql), 'references conversion_points', ''))) / 28
   + (length(lower(sql)) - length(replace(lower(sql), 'references "conversion_points"', ''))) / 30
   + (length(lower(sql)) - length(replace(lower(sql), 'references [conversion_points]', ''))) / 30
   + (length(lower(sql)) - length(replace(lower(sql), 'references `conversion_points`', ''))) / 30
 ), 0)
 FROM sqlite_schema WHERE type = 'table' AND name != '_cf_METADATA'
) = 4 THEN '{}' ELSE 'unexpected conversion_points foreign key count: stop migration 440' END);
SELECT json(CASE WHEN NOT EXISTS(
  SELECT 1 FROM sqlite_schema
  WHERE type = 'table' AND name != '_cf_METADATA'
  AND name NOT IN ('conversion_events', 'conversion_event_dedup_claims', 'conversion_definition_usages', 'conversion_definition_revisions')
  AND (
    lower(sql) LIKE '%references conversion_points%'
    OR lower(sql) LIKE '%references "conversion_points"%'
    OR lower(sql) LIKE '%references [conversion_points]%'
    OR lower(sql) LIKE '%references `conversion_points`%'
  )
) THEN '{}' ELSE 'unexpected table references conversion_points: stop migration 440' END);

-- CASCADE の子を丸ごと退避する。列の追加・改名を受けない完全な写し。
CREATE TABLE migration_440_conversion_events_backup AS SELECT * FROM conversion_events;
CREATE TABLE migration_440_dedup_claims_backup AS SELECT * FROM conversion_event_dedup_claims;
CREATE TABLE migration_440_revisions_backup AS SELECT * FROM conversion_definition_revisions;

DELETE FROM conversion_events;
DELETE FROM conversion_event_dedup_claims;
DELETE FROM conversion_definition_revisions;

CREATE TABLE conversion_points_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value      REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'stopped', 'draft')),
  stopped_at TEXT,
  updated_at TEXT,
  measure_method TEXT NOT NULL DEFAULT 'manual'
             CHECK (measure_method IN ('url_reach', 'webhook', 'manual')),
  target_url TEXT,
  count_repeat INTEGER NOT NULL DEFAULT 1,
  attribution_days INTEGER,
  line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  source_config_json TEXT NOT NULL DEFAULT '{}'
             CHECK (json_valid(source_config_json)),
  deduplication_mode TEXT NOT NULL DEFAULT 'every'
             CHECK (deduplication_mode IN ('every', 'once_per_friend', 'window')),
  deduplication_window_days INTEGER
             CHECK (deduplication_window_days IS NULL OR deduplication_window_days BETWEEN 1 AND 365),
  value_mode TEXT NOT NULL DEFAULT 'fixed'
             CHECK (value_mode IN ('source', 'fixed', 'none')),
  reversal_policy TEXT NOT NULL DEFAULT 'manual'
             CHECK (reversal_policy IN ('source_cancelled', 'manual', 'none')),
  tenant_id  TEXT REFERENCES tenants(id),
  ingest_secret_encrypted TEXT,
  ingest_disabled_at TEXT
);

INSERT INTO conversion_points_new (
  id, name, event_type, value, created_at, status, stopped_at, updated_at,
  measure_method, target_url, count_repeat, attribution_days, line_account_id,
  version, source_config_json, deduplication_mode, deduplication_window_days,
  value_mode, reversal_policy, tenant_id
)
SELECT
  id, name, event_type, value, created_at, status, stopped_at, updated_at,
  measure_method, target_url, count_repeat, attribution_days, line_account_id,
  version, source_config_json, deduplication_mode, deduplication_window_days,
  value_mode, reversal_policy, tenant_id
FROM conversion_points;

DROP TABLE conversion_points;
ALTER TABLE conversion_points_new RENAME TO conversion_points;

-- 退避した子を同じ行で戻す。id は変わらないので外部参照はそのまま解決する。
INSERT INTO conversion_events SELECT * FROM migration_440_conversion_events_backup;
INSERT INTO conversion_event_dedup_claims SELECT * FROM migration_440_dedup_claims_backup;
INSERT INTO conversion_definition_revisions SELECT * FROM migration_440_revisions_backup;

DROP TABLE migration_440_conversion_events_backup;
DROP TABLE migration_440_dedup_claims_backup;
DROP TABLE migration_440_revisions_backup;

-- 表の作り直しで消える索引とトリガを貼り直す。
CREATE INDEX idx_conversion_points_status ON conversion_points(status, created_at DESC);
CREATE INDEX idx_conversion_points_tenant ON conversion_points(tenant_id);
CREATE INDEX idx_conversion_points_ingest ON conversion_points(id)
  WHERE ingest_secret_encrypted IS NOT NULL;

CREATE TRIGGER conversion_points_prevent_delete
BEFORE DELETE ON conversion_points
WHEN EXISTS (
  SELECT 1 FROM conversion_events WHERE conversion_point_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM conversion_definition_usages WHERE conversion_point_id = OLD.id
)
BEGIN SELECT RAISE(ABORT, 'conversion point with events or usages cannot be deleted'); END;

-- 外部受信の台帳(N-270)。成否・理由・送り側のイベントIDだけを残し、
-- 秘密値・署名・本文の中身は残さない。
CREATE TABLE conversion_ingestion_events (
  id                  TEXT PRIMARY KEY,
  conversion_point_id TEXT NOT NULL,
  result              TEXT NOT NULL
                      CHECK (result IN ('recorded', 'duplicate', 'rejected')),
  reason              TEXT,
  source_event_id     TEXT,
  friend_id           TEXT,
  payload_shape_json  TEXT,
  signature_sha256    TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX idx_conversion_ingestion_events_point
  ON conversion_ingestion_events(conversion_point_id, created_at DESC);
