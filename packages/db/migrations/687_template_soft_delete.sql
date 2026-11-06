-- Preserve version history and sent content when a template is removed.
ALTER TABLE templates ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_templates_deleted ON templates(deleted_at);
