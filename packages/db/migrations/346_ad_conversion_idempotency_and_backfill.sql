-- 広告成果送信の呼び出し跨ぎ重複を止める冪等キー(#638 差し戻し対応)と、
-- 帰属不明の旧行の安全な移行。
-- 冪等キーは送信元が持つ安定ID(StripeイベントID・EC受信行ID等)を入れる。
-- 同じ(設定・友だち・出来事・キー)の送信済みがあるときは送らない。
ALTER TABLE ad_conversion_logs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_conversion_logs_idempotency
  ON ad_conversion_logs(ad_platform_id, friend_id, event_name, idempotency_key);

-- 安全な帰属移行: アカウントが1つしかない配備では、帰属不明の旧設定は
-- その1つに属すると断定できるので付ける。複数ある配備は NULL のまま残す。
UPDATE ad_platforms
   SET line_account_id = (SELECT id FROM line_accounts LIMIT 1)
 WHERE line_account_id IS NULL
   AND (SELECT COUNT(*) FROM line_accounts) = 1;

-- 送信記録の帰属は友だちの所属から復元できるので、欠けている分だけ埋める。
UPDATE ad_conversion_logs
   SET line_account_id = (SELECT line_account_id FROM friends WHERE friends.id = ad_conversion_logs.friend_id)
 WHERE line_account_id IS NULL;
