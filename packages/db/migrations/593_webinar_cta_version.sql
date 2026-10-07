-- 草稿: 番号・適用ともオーナー承認待ち。D1 には適用しない。
ALTER TABLE webinars ADD COLUMN cta_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webinars ADD COLUMN cta_updated_by TEXT;
ALTER TABLE webinars ADD COLUMN cta_updated_at TEXT;
-- 一括保存が版の比較に勝ったことを、同じbatch内の各書き込みに伝える印。
ALTER TABLE webinars ADD COLUMN cta_write_token TEXT;
