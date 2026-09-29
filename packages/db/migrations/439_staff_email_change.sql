-- #957 監査是正 N-433: 本人のメールアドレス変更を確認メール付きにする。
--
-- 直す前は PATCH /api/staff/:id が email をそのまま上書きし、新しい宛先が
-- 本人のものか確かめずに切り替わっていた。セッションを盗まれたとき、
-- 届かない宛先へ静かに書き換えて乗っ取れる。
--
-- email_change_new: 確認待ちの新しいメールアドレス。確認するまで email は変えない。
-- email_change_token_hash: 確認リンクの指紋(sha256)。生のトークンはDBへ置かない。
-- email_change_expires_at: 確認リンクの期限(24時間)。
ALTER TABLE staff_members ADD COLUMN email_change_new TEXT;
ALTER TABLE staff_members ADD COLUMN email_change_token_hash TEXT;
ALTER TABLE staff_members ADD COLUMN email_change_expires_at TEXT;
