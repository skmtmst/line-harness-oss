-- いまの trigger_type / trigger_tag_id を、そのまま新しい表へ移す。
--
-- 移し終えても scenarios.trigger_type は残す。消すと、まだ古い列を見て
-- いる箇所（あれば）が黙って動かなくなる。読む側を全部切り替えてから
-- 別のマイグレーションで落とす。
--
-- 'manual' は行を作らない（きっかけが無い状態）。
INSERT OR IGNORE INTO scenario_triggers (id, scenario_id, kind, tag_id)
SELECT
  lower(hex(randomblob(16))),
  id,
  trigger_type,
  CASE WHEN trigger_type = 'tag_added' THEN trigger_tag_id ELSE NULL END
FROM scenarios
WHERE trigger_type IN ('friend_add', 'tag_added')
  AND (trigger_type != 'tag_added' OR trigger_tag_id IS NOT NULL);
