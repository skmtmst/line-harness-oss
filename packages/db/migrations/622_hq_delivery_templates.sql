-- オーナー承認: 2026-10-10 / B-173。既存の型・外部キー・配布台帳を保持する。
-- 配り方の論理型を追加し、旧 template_type の CHECK はそのまま使う。
ALTER TABLE hq_templates ADD COLUMN delivery_type TEXT
  CHECK (delivery_type IS NULL OR delivery_type IN ('auto_reply','friend_add_rule','reminder'));
CREATE TRIGGER hq_template_delivery_insert BEFORE INSERT ON hq_templates
WHEN NEW.delivery_type IS NOT NULL AND
  (NEW.template_type!='template' OR NEW.extended_type IS NOT NULL OR NEW.friend_attribute_type IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'HQ_TYPE_INVALID'); END;
CREATE TRIGGER hq_template_delivery_update BEFORE UPDATE ON hq_templates
WHEN NEW.delivery_type IS NOT OLD.delivery_type OR
  (NEW.delivery_type IS NOT NULL AND (NEW.template_type!='template' OR NEW.extended_type IS NOT NULL OR NEW.friend_attribute_type IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'HQ_TYPE_IMMUTABLE'); END;
