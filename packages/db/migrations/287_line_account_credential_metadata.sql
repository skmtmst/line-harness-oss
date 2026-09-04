-- V6 33-3: 秘密値を公開せず、登録済み資格情報を運用者が識別できるようにする。

ALTER TABLE line_accounts ADD COLUMN channel_access_token_updated_at TEXT;
ALTER TABLE line_accounts ADD COLUMN channel_secret_updated_at TEXT;
ALTER TABLE line_accounts ADD COLUMN login_channel_secret_updated_at TEXT;

UPDATE line_accounts
   SET channel_access_token_updated_at = updated_at
 WHERE channel_access_token_encrypted IS NOT NULL
    OR COALESCE(channel_access_token, '') != '';

UPDATE line_accounts
   SET channel_secret_updated_at = updated_at
 WHERE channel_secret_encrypted IS NOT NULL
    OR COALESCE(channel_secret, '') != '';

UPDATE line_accounts
   SET login_channel_secret_updated_at = updated_at
 WHERE COALESCE(login_channel_secret, '') != '';
