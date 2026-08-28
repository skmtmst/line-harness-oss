-- 広告接続と成果送信履歴を、選択中のLINEアカウントから分離できるようにする。
-- 複数アカウント環境の旧接続は所属を推測せず、明示的な移行まで未割り当てに残す。
ALTER TABLE ad_platforms
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

ALTER TABLE ad_conversion_logs
  ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE;

-- 送信履歴は友だちの所属が正本。所属が確定している行だけ補完する。
UPDATE ad_conversion_logs
   SET line_account_id = (
     SELECT f.line_account_id FROM friends f WHERE f.id = ad_conversion_logs.friend_id
   )
 WHERE line_account_id IS NULL
   AND EXISTS (
     SELECT 1 FROM friends f
      WHERE f.id = ad_conversion_logs.friend_id
        AND f.line_account_id IS NOT NULL
   );

-- LINEアカウントが1件だけなら、既存の広告接続はそのアカウントのものと確定できる。
UPDATE ad_platforms
   SET line_account_id = (SELECT id FROM line_accounts ORDER BY id LIMIT 1)
 WHERE line_account_id IS NULL
   AND (SELECT COUNT(*) FROM line_accounts) = 1;

CREATE INDEX IF NOT EXISTS idx_ad_platforms_account_active
  ON ad_platforms(line_account_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_account_created
  ON ad_conversion_logs(line_account_id, created_at DESC, id);
