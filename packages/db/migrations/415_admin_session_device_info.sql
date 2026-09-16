-- N-427: 本人のセッション一覧・個別失効のため、端末を見分ける情報を持つ。
-- user_agent/ip_prefix は表示用（IPは先頭2オクテットまでの伏せ形）。
ALTER TABLE admin_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE admin_sessions ADD COLUMN ip_prefix TEXT;
