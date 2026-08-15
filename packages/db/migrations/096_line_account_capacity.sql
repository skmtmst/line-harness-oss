-- LINEアカウントの上限とアイコン。
-- 友だち数の上限に近づいたことを画面で知らせる手立てが無かった。

-- 友だち数の上限。NULL なら上限を管理しない。
ALTER TABLE line_accounts ADD COLUMN friend_capacity INTEGER;

-- 何人で警告を出すか。NULL なら警告しない。
ALTER TABLE line_accounts ADD COLUMN capacity_warn_at INTEGER;

-- 管理画面の一覧やヘッダーで使うアイコン。
-- og_default_image_url は共有時のOGP用で用途が違うため、別に持つ。
ALTER TABLE line_accounts ADD COLUMN icon_url TEXT;
