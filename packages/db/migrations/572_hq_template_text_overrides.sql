-- Confirmed per-account wording is immutable, including after interrupted runs.
ALTER TABLE hq_template_preflights ADD COLUMN text_override TEXT
  CHECK (text_override IS NULL OR length(trim(text_override)) BETWEEN 1 AND 5000);
CREATE TRIGGER hq_template_text_override_immutable BEFORE UPDATE OF text_override ON hq_template_preflights
WHEN NEW.text_override IS NOT OLD.text_override
BEGIN SELECT RAISE(ABORT,'HQ_TEXT_OVERRIDE_IMMUTABLE'); END;
