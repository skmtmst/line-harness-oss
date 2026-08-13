-- Editable copy wraps mandatory commerce facts; mandatory facts are rendered
-- by Worker code and cannot be removed from the admin UI.
ALTER TABLE ec_notification_settings ADD COLUMN intro_text TEXT;
ALTER TABLE ec_notification_settings ADD COLUMN outro_text TEXT;

-- Preserve the wording used before this migration.
UPDATE ec_notification_settings
   SET outro_text = 'ご利用ありがとうございました。'
 WHERE event_type = 'ec.subscription.cancelled'
   AND outro_text IS NULL;
