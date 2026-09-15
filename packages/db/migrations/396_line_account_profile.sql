-- Cache the public LINE Official Account profile for fast account listings.
-- Values are refreshed after connection checks and by the existing cron.
ALTER TABLE line_accounts ADD COLUMN line_display_name TEXT;
ALTER TABLE line_accounts ADD COLUMN line_picture_url TEXT;
ALTER TABLE line_accounts ADD COLUMN line_basic_id TEXT;
ALTER TABLE line_accounts ADD COLUMN line_profile_synced_at TEXT;
