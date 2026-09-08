-- 367: 1人1回・期間内重複の同時計上をDB制約で止める(N-255)。
--
-- trackConversion の重複判定は読取り後書込みで、同じ元イベントの
-- 同時到着を2件計上し得る。重複防止キー once_key を足し、部分UNIQUEで
-- 同時到着の片方を必ず弾く。
--
-- 既存行の削除はしない。成果イベントは精算(非cascade FK)や監査・支払の
-- 根拠になるため、履歴を壊さないことが条件。lifetime地点の重複は
-- 勝者(承認済み優先、同順は古い順、同着は小さいid)1件だけに鍵を付け、
-- 敗者は鍵なしのまま履歴として残す(制約の対象外)。window地点の既存行は
-- 鍵なしのままにし、記録時の期間確認で数える。
--
-- 鍵の形: lifetime は 地点|友だち、window は 地点|友だち|w期間日数:区切り。
-- 繰返し数える地点(every)の行は鍵なしで、従来どおり何件でも記録できる。

ALTER TABLE conversion_events ADD COLUMN once_key TEXT;

UPDATE conversion_events
SET once_key = conversion_point_id || '|' || friend_id
WHERE once_key IS NULL AND id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY conversion_point_id, friend_id
             ORDER BY CASE approval_status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                      created_at ASC, id ASC
           ) AS rn
    FROM conversion_events
    WHERE conversion_point_id IN (
      SELECT id FROM conversion_points
      WHERE count_repeat = 0
        AND COALESCE(deduplication_mode, 'every') != 'window'
    )
  ) WHERE rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_events_once_key
  ON conversion_events(once_key) WHERE once_key IS NOT NULL;
