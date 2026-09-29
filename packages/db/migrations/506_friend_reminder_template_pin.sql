-- R346: 通知の登録時に使っていたテンプレートの公開版を記録する。
-- {"テンプレートID": 公開版番号} の JSON。新しい版にするのは登録し直した時だけ。
-- 記録が無い既存の登録は NULL のまま、今までどおり最新の版を読む。
ALTER TABLE friend_reminders ADD COLUMN template_version_snapshot TEXT;
