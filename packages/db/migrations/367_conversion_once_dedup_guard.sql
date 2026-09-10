-- N-255: 1人1回・rolling windowの同時到着をDBで直列化する。
--
-- event側の区切り文字付きTEXTキーは、IDに区切り文字を含む別組を
-- 衝突させるうえ、rolling windowを固定epoch区画へ変えてしまう。
-- 地点IDと友だちIDを別列の複合主キーにし、最後に権利を得たeventと
-- 時刻をclaim台帳へ保持する。既存eventは一件も削除しない。
--
-- 全文を再実行できる文だけで構成する。CREATE後や正規化途中で止まっても、
-- 同じmigrationを実runnerから再実行すればblank/部分適用行を修復できる。

DROP INDEX IF EXISTS idx_conversion_events_once_key;

CREATE TABLE IF NOT EXISTS conversion_event_dedup_claims (
  conversion_point_id TEXT NOT NULL REFERENCES conversion_points(id) ON DELETE CASCADE,
  friend_id           TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  mode                TEXT NOT NULL CHECK (mode IN ('lifetime', 'window')),
  window_days         INTEGER CHECK (window_days IS NULL OR window_days BETWEEN 1 AND 365),
  last_event_id       TEXT NOT NULL,
  last_at             TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (conversion_point_id, friend_id),
  CHECK ((mode = 'lifetime' AND window_days IS NULL)
      OR (mode = 'window' AND window_days IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_conversion_event_dedup_claims_event
  ON conversion_event_dedup_claims(last_event_id);

-- 途中適用で残った空欄・event不在claimは、event履歴を触らずclaimだけ除去する。
DELETE FROM conversion_event_dedup_claims
 WHERE trim(conversion_point_id) = ''
    OR trim(friend_id) = ''
    OR trim(last_event_id) = ''
    OR trim(last_at) = ''
    OR NOT EXISTS (
      SELECT 1 FROM conversion_events ce
       WHERE ce.id = conversion_event_dedup_claims.last_event_id
         AND ce.conversion_point_id = conversion_event_dedup_claims.conversion_point_id
         AND ce.friend_id = conversion_event_dedup_claims.friend_id
    );

-- lifetimeは、承認済み/計上済みを優先し、同順位は古いeventを勝者にする。
INSERT INTO conversion_event_dedup_claims
  (conversion_point_id, friend_id, mode, window_days, last_event_id, last_at, updated_at)
SELECT conversion_point_id, friend_id, 'lifetime', NULL, id, created_at,
       strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
  FROM (
    SELECT ce.*,
           ROW_NUMBER() OVER (
             PARTITION BY ce.conversion_point_id, ce.friend_id
             ORDER BY CASE ce.approval_status
               WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
               ce.created_at ASC, ce.id ASC
           ) AS rn
      FROM conversion_events ce
      JOIN conversion_points cp ON cp.id = ce.conversion_point_id
     WHERE cp.count_repeat = 0
       AND COALESCE(cp.deduplication_mode, 'every') != 'window'
  ) ranked
 WHERE rn = 1
ON CONFLICT(conversion_point_id, friend_id) DO UPDATE SET
  mode = excluded.mode,
  window_days = excluded.window_days,
  last_event_id = excluded.last_event_id,
  last_at = excluded.last_at,
  updated_at = excluded.updated_at;

-- rolling windowは最新eventを起点にする。固定epoch bucketは使わない。
INSERT INTO conversion_event_dedup_claims
  (conversion_point_id, friend_id, mode, window_days, last_event_id, last_at, updated_at)
SELECT conversion_point_id, friend_id, 'window', deduplication_window_days,
       id, created_at, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
  FROM (
    SELECT ce.*, cp.deduplication_window_days,
           ROW_NUMBER() OVER (
             PARTITION BY ce.conversion_point_id, ce.friend_id
             ORDER BY ce.created_at DESC, ce.id DESC
           ) AS rn
      FROM conversion_events ce
      JOIN conversion_points cp ON cp.id = ce.conversion_point_id
     WHERE cp.count_repeat = 0
       AND cp.deduplication_mode = 'window'
       AND cp.deduplication_window_days BETWEEN 1 AND 365
  ) ranked
 WHERE rn = 1
ON CONFLICT(conversion_point_id, friend_id) DO UPDATE SET
  mode = excluded.mode,
  window_days = excluded.window_days,
  last_event_id = excluded.last_event_id,
  last_at = excluded.last_at,
  updated_at = excluded.updated_at;

-- 現在everyの地点や存在しない地点に残る旧claimを除く。eventは保持する。
DELETE FROM conversion_event_dedup_claims
 WHERE NOT EXISTS (
   SELECT 1 FROM conversion_points cp
    WHERE cp.id = conversion_event_dedup_claims.conversion_point_id
      AND cp.count_repeat = 0
      AND (COALESCE(cp.deduplication_mode, 'every') != 'window'
        OR cp.deduplication_window_days BETWEEN 1 AND 365)
 );
