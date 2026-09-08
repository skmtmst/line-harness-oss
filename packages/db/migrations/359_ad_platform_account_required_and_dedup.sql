-- 広告設定の帰属の必須化・重複禁止と、346 の履歴移行の訂正(#638 差し戻し再審査)。
-- 1) 346 は送信記録の帰属を友だちの現所属から復元した。媒体設定a1・友だち現所属a2の
--    行は a2 へ誤って移る。正しくは送信に使った資格情報(媒体設定側)を優先する。
UPDATE ad_conversion_logs
   SET line_account_id = (
     SELECT p.line_account_id FROM ad_platforms p WHERE p.id = ad_conversion_logs.ad_platform_id
   )
 WHERE EXISTS (
   SELECT 1 FROM ad_platforms p
    WHERE p.id = ad_conversion_logs.ad_platform_id AND p.line_account_id IS NOT NULL
 )
   AND (
     line_account_id IS NULL
     OR line_account_id != (
       SELECT p.line_account_id FROM ad_platforms p WHERE p.id = ad_conversion_logs.ad_platform_id
     )
   );

-- 2) 帰属のない新規設定を作らせない(既存の帰属不明行は残す)。戻しも止める。
CREATE TRIGGER IF NOT EXISTS trg_ad_platforms_account_required_insert
BEFORE INSERT ON ad_platforms
WHEN NEW.line_account_id IS NULL
BEGIN SELECT RAISE(ABORT, 'ad_platforms.line_account_id is required'); END;

CREATE TRIGGER IF NOT EXISTS trg_ad_platforms_account_required_update
BEFORE UPDATE OF line_account_id ON ad_platforms
WHEN NEW.line_account_id IS NULL
BEGIN SELECT RAISE(ABORT, 'ad_platforms.line_account_id cannot be cleared'); END;

-- 3) 同一アカウント・同一媒体の重複設定を禁じる(NULL同士は別行として許す)。
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_platforms_account_name
  ON ad_platforms(line_account_id, name);

-- 4) 冪等キーでの所属固定の読み出し用。
CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_friend_event_key
  ON ad_conversion_logs(friend_id, event_name, idempotency_key);
