-- 広告設定の帰属の必須化・重複整理と、送信記録の帰属の正規化(#638 差し戻し再審査)。
-- 359 は未統合のため、同番号内で司令塔指示の修正を行う。
-- 1) 同一アカウント・同一媒体の重複設定を整理する。送信記録は残す行へ
--    付け替え、付け替えで一意がぶつかる記録は sent を最優先に残す。
--    帰属不明(NULL)群は触らない。
DELETE FROM ad_conversion_logs WHERE id IN (
  SELECT loser.id FROM ad_conversion_logs loser
  JOIN ad_platforms pl ON pl.id = loser.ad_platform_id
 WHERE loser.idempotency_key IS NOT NULL
   AND pl.line_account_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM ad_conversion_logs keeper
     JOIN ad_platforms pk ON pk.id = keeper.ad_platform_id
      WHERE keeper.id != loser.id
        AND keeper.friend_id = loser.friend_id
        AND keeper.event_name = loser.event_name
        AND keeper.idempotency_key = loser.idempotency_key
        AND pk.line_account_id = pl.line_account_id
        AND pk.name = pl.name
        AND (
          CASE keeper.status WHEN 'sent' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END
          < CASE loser.status WHEN 'sent' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END
          OR (
            CASE keeper.status WHEN 'sent' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END
            = CASE loser.status WHEN 'sent' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END
            AND (
              keeper.created_at > loser.created_at
              OR (keeper.created_at = loser.created_at AND keeper.id > loser.id)
            )
          )
        )
   )
);

UPDATE ad_conversion_logs SET ad_platform_id = (
  SELECT w.id FROM ad_platforms w, ad_platforms cur
   WHERE cur.id = ad_conversion_logs.ad_platform_id
     AND w.line_account_id = cur.line_account_id
     AND w.name = cur.name
     AND w.line_account_id IS NOT NULL
   ORDER BY w.updated_at DESC, w.created_at ASC, w.id ASC LIMIT 1)
 WHERE EXISTS (
  SELECT 1 FROM ad_platforms cur, ad_platforms other
   WHERE cur.id = ad_conversion_logs.ad_platform_id
     AND other.line_account_id = cur.line_account_id
     AND other.name = cur.name
     AND other.id != cur.id
     AND cur.line_account_id IS NOT NULL);

DELETE FROM ad_platforms WHERE line_account_id IS NOT NULL AND id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY line_account_id, name ORDER BY updated_at DESC, created_at ASC, id ASC
    ) AS rn FROM ad_platforms WHERE line_account_id IS NOT NULL)
  WHERE rn = 1);

-- 2) 送信記録の帰属は媒体設定を正とする。346 は友だちの現所属で埋めたため、
--    媒体a1・友だち現所属a2の行が a2 へ誤って移る。媒体が不明の行は不明(NULL)に戻す。
UPDATE ad_conversion_logs
   SET line_account_id = (
     SELECT p.line_account_id FROM ad_platforms p WHERE p.id = ad_conversion_logs.ad_platform_id
   )
 WHERE line_account_id IS DISTINCT FROM (
   SELECT p.line_account_id FROM ad_platforms p WHERE p.id = ad_conversion_logs.ad_platform_id
 );

-- 3) 帰属のない新規設定を作らせない(既存の帰属不明行は残す)。戻しも止める。
CREATE TRIGGER IF NOT EXISTS trg_ad_platforms_account_required_insert
BEFORE INSERT ON ad_platforms
WHEN NEW.line_account_id IS NULL
BEGIN SELECT RAISE(ABORT, 'ad_platforms.line_account_id is required'); END;

CREATE TRIGGER IF NOT EXISTS trg_ad_platforms_account_required_update
BEFORE UPDATE OF line_account_id ON ad_platforms
WHEN NEW.line_account_id IS NULL
BEGIN SELECT RAISE(ABORT, 'ad_platforms.line_account_id cannot be cleared'); END;

-- 4) 同一アカウント・同一媒体の重複設定を禁じる(NULL同士は別行として許す)。
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_platforms_account_name
  ON ad_platforms(line_account_id, name);

-- 5) 冪等キーでの所属固定の読み出し用。
CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_friend_event_key
  ON ad_conversion_logs(friend_id, event_name, idempotency_key);
