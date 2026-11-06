-- 草稿：D1への適用は司令塔が承認を得てから行う。
-- 会社名は既存の統括名と共用し、表示設定だけ追加する。
ALTER TABLE tenants ADD COLUMN login_display_name TEXT;
ALTER TABLE tenants ADD COLUMN logo_media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN logo_background_color TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE tenants ADD COLUMN company_settings_version INTEGER NOT NULL DEFAULT 0
  CHECK (company_settings_version >= 0);
