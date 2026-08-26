-- V6の日時指定・毎日・毎週オートメーションが基準にするタイムゾーン。
-- 既存の管理画面と日時表示は日本時間を正本としてきたため、既存行は
-- Asia/Tokyo で継続する。新規・編集APIではIANA名を明示して保存する。

ALTER TABLE line_accounts
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo';
