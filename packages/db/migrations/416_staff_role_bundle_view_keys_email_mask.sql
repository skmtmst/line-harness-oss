-- N-424: 役割bundle（受付/運用の区別）・項目別3択（viewレベル）・個人情報の見せ方を保持する。
-- role_bundle: NULL は従来どおり role+access_level から導出。明示保存した束だけを記録する。
-- view_permission_keys: 「見えるだけ」の permission key(JSON配列)。GET系だけを許可する。
-- email_mask: スタッフのメール表示。'full'|'masked'|'none'、NULL は従来判定（access.user.email.view）。
ALTER TABLE staff_members ADD COLUMN role_bundle TEXT;
ALTER TABLE staff_members ADD COLUMN view_permission_keys TEXT;
ALTER TABLE staff_members ADD COLUMN email_mask TEXT;
