-- 367: 1人1回地点の同時重複計上をDB制約で止める(N-255)。
--
-- trackConversion の1人1回判定は読取り後書込みで、同じ元イベントの
-- 同時到着を2件計上し得る。1人1回(count_repeat = 0)の地点の行だけに
-- 入る once_key を足し、部分UNIQUEで同時到着の片方を必ず弾く。
-- 繰返し数える地点(count_repeat = 1)の行は once_key が NULL のまま
-- 制約の対象外なので、従来どおり何件でも記録できる。
--
-- 既存の重複があっても止まらないよう、先に決定的に1件へ整理する。
-- 残す優先順位は「承認済み(計上済み) > 承認待ち > それ以外」、
-- 同順なら古い created_at、同着なら小さい id(先勝ち)。

DELETE FROM conversion_events
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY conversion_point_id, friend_id
             ORDER BY CASE approval_status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                      created_at ASC, id ASC
           ) AS rn
    FROM conversion_events
    WHERE conversion_point_id IN (SELECT id FROM conversion_points WHERE count_repeat = 0)
  ) WHERE rn > 1
);

ALTER TABLE conversion_events ADD COLUMN once_key TEXT;

UPDATE conversion_events
SET once_key = conversion_point_id || '|' || friend_id
WHERE once_key IS NULL
  AND conversion_point_id IN (SELECT id FROM conversion_points WHERE count_repeat = 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_events_once_key
  ON conversion_events(once_key) WHERE once_key IS NOT NULL;
