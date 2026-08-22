-- LINE Messaging API credentials are encrypted by the Worker with AES-GCM.
-- The legacy plaintext columns remain during the staged migration and rollback window.
ALTER TABLE line_accounts ADD COLUMN channel_access_token_encrypted TEXT;
ALTER TABLE line_accounts ADD COLUMN channel_secret_encrypted TEXT;
