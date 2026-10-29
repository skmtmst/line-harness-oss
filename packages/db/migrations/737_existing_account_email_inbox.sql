-- 新規アカウントはLINEだけを受信箱に表示する。
-- migration-state: ledger-only
-- 既存アカウントのメール表示は変更しない。今後のメール接続は個別設計後に扱う。
INSERT OR IGNORE INTO account_settings (id, line_account_id, key, value)
SELECT lower(hex(randomblob(16))), id, 'inbox_email_legacy_enabled', 'true'
FROM line_accounts;
