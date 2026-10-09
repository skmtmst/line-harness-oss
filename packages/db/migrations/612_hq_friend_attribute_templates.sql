-- Logical friend attributes retain the existing storage type and child foreign keys.
ALTER TABLE hq_templates ADD COLUMN friend_attribute_type TEXT
  CHECK (friend_attribute_type IS NULL OR friend_attribute_type IN ('friend_field','mark'));
CREATE TRIGGER hq_template_friend_attribute_insert BEFORE INSERT ON hq_templates
WHEN NEW.friend_attribute_type IS NOT NULL
  AND (NEW.template_type!='tag' OR NEW.extended_type IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'HQ_TYPE_INVALID'); END;
CREATE TRIGGER hq_template_friend_attribute_update BEFORE UPDATE OF friend_attribute_type ON hq_templates
WHEN NEW.friend_attribute_type IS NOT OLD.friend_attribute_type
BEGIN SELECT RAISE(ABORT,'HQ_TYPE_IMMUTABLE'); END;

-- Skip is an additive extension. The legacy mode CHECK and all old kinds stay intact.
ALTER TABLE hq_template_preflight_resolutions ADD COLUMN friend_attribute_mode TEXT
  CHECK (friend_attribute_mode IS NULL OR (friend_attribute_mode='skip' AND resolution_mode='overwrite' AND NOT (target_id IS NULL)));
CREATE TRIGGER hq_attribute_skip_insert BEFORE INSERT ON hq_template_preflight_resolutions
WHEN NEW.friend_attribute_mode IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM hq_templates t WHERE t.id=NEW.template_id AND t.tenant_id=NEW.tenant_id
    AND t.friend_attribute_type=NEW.item_kind)
BEGIN SELECT RAISE(ABORT,'HQ_ATTRIBUTE_SKIP_INVALID'); END;
CREATE TRIGGER hq_attribute_skip_update BEFORE UPDATE ON hq_template_preflight_resolutions
WHEN NEW.friend_attribute_mode IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM hq_templates t WHERE t.id=NEW.template_id AND t.tenant_id=NEW.tenant_id
    AND t.friend_attribute_type=NEW.item_kind)
BEGIN SELECT RAISE(ABORT,'HQ_ATTRIBUTE_SKIP_INVALID'); END;
