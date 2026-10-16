-- オーナー承認 B-316 (2026-10-15): 661〜662 の枠内。既存の表・制約を保持する。
-- 予約メニューとマイルの景品は共通の固定版・配布台帳を使うため、追加はこの1列だけ。
ALTER TABLE hq_templates ADD COLUMN catalog_type TEXT
  CHECK (catalog_type IS NULL OR catalog_type IN ('booking_menu','mileage_reward'));
CREATE TRIGGER hq_template_catalog_insert BEFORE INSERT ON hq_templates WHEN NEW.catalog_type IS NOT NULL AND (NEW.template_type<>'template' OR NEW.extended_type IS NOT NULL OR NEW.friend_attribute_type IS NOT NULL OR NEW.delivery_type IS NOT NULL) BEGIN SELECT RAISE(ABORT,'HQ_TYPE_INVALID'); END;
CREATE TRIGGER hq_template_catalog_update BEFORE UPDATE ON hq_templates WHEN NEW.catalog_type IS NOT OLD.catalog_type OR (NEW.catalog_type IS NOT NULL AND (NEW.template_type<>'template' OR NEW.extended_type IS NOT NULL OR NEW.friend_attribute_type IS NOT NULL OR NEW.delivery_type IS NOT NULL)) BEGIN SELECT RAISE(ABORT,'HQ_TYPE_IMMUTABLE'); END;
