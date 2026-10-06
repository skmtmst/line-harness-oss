-- Keep the existing four-type storage and its child foreign keys intact.
-- Logical scenario templates use the extension; APIs never expose the backing type.
ALTER TABLE hq_templates ADD COLUMN extended_type TEXT CHECK (extended_type IS NULL OR extended_type='scenario');
CREATE TRIGGER hq_template_extended_type_insert BEFORE INSERT ON hq_templates
WHEN NEW.extended_type IS NOT NULL AND NEW.template_type!='template'
BEGIN SELECT RAISE(ABORT,'HQ_TYPE_INVALID'); END;
CREATE TRIGGER hq_template_extended_type_update BEFORE UPDATE OF extended_type ON hq_templates
WHEN NEW.extended_type IS NOT OLD.extended_type
BEGIN SELECT RAISE(ABORT,'HQ_TYPE_IMMUTABLE'); END;
