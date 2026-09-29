-- Dashboard V6: LINE公式プロフィールの短縮URLをアカウント単位で保持する。
-- LINE Bot情報APIはbasicIdしか返さず、lin.ee URLは取得できないため運用設定として保存する。

ALTER TABLE line_accounts ADD COLUMN official_profile_url TEXT;
