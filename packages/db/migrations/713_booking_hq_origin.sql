ALTER TABLE menus ADD COLUMN hq_template_id TEXT;
ALTER TABLE menus ADD COLUMN hq_template_version_id TEXT;
ALTER TABLE menus ADD COLUMN hq_customized INTEGER NOT NULL DEFAULT 0 CHECK(hq_customized IN(0,1));
ALTER TABLE menus ADD COLUMN image_url TEXT;
CREATE TRIGGER booking_hq_local_edit AFTER UPDATE OF name,description,duration_minutes,base_price,buffer_after_minutes,category_label,audience_mode,audience_tag_ids_json ON menus
WHEN OLD.hq_template_id IS NOT NULL AND NEW.hq_template_version_id IS OLD.hq_template_version_id
AND (OLD.name IS NOT NEW.name OR OLD.description IS NOT NEW.description OR OLD.duration_minutes IS NOT NEW.duration_minutes OR OLD.base_price IS NOT NEW.base_price OR OLD.buffer_after_minutes IS NOT NEW.buffer_after_minutes OR OLD.category_label IS NOT NEW.category_label OR OLD.audience_mode IS NOT NEW.audience_mode OR OLD.audience_tag_ids_json IS NOT NEW.audience_tag_ids_json)
BEGIN UPDATE menus SET hq_customized=1 WHERE id=NEW.id; END;
CREATE TRIGGER booking_hq_archive_origin AFTER UPDATE OF archived_at ON hq_templates WHEN NEW.archived_at IS NOT NULL
BEGIN UPDATE menus SET hq_template_id=NULL,hq_template_version_id=NULL,hq_customized=0 WHERE hq_template_id=NEW.id; END;

CREATE TRIGGER booking_hq_origin_insert BEFORE INSERT ON menus WHEN NEW.hq_template_id IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id JOIN line_accounts a ON a.tenant_id=t.tenant_id WHERE t.id=NEW.hq_template_id AND v.id=NEW.hq_template_version_id AND a.id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'hq_origin_account_mismatch'); END;
CREATE TRIGGER booking_hq_origin_update BEFORE UPDATE OF hq_template_id,hq_template_version_id ON menus WHEN NEW.hq_template_id IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id JOIN line_accounts a ON a.tenant_id=t.tenant_id WHERE t.id=NEW.hq_template_id AND v.id=NEW.hq_template_version_id AND a.id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'hq_origin_account_mismatch'); END;
