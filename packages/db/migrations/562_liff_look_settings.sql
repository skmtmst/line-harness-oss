-- LIFF の見た目の設定置き場（M3）。付け足しだけ。既存の列は触らない。
-- 店（booking_settings）：型・店の色（主・地・見出しの書体）・カレンダーの
-- 出し方・空きの点。選んでいない店は 'line'（今の見た目のまま）。
-- 回答フォーム（forms）：既定は 'inherit'（店の設定に合わせる）。
-- この migration は作るだけ。適用は M2 の適用手順に合わせる。
ALTER TABLE booking_settings
  ADD COLUMN liff_theme TEXT NOT NULL DEFAULT 'line'
  CHECK (liff_theme IN ('natural', 'modern', 'gentle', 'night', 'line'));
ALTER TABLE booking_settings
  ADD COLUMN liff_primary_color TEXT
  CHECK (liff_primary_color IS NULL OR liff_primary_color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]');
ALTER TABLE booking_settings
  ADD COLUMN liff_background_color TEXT
  CHECK (liff_background_color IS NULL OR liff_background_color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]');
ALTER TABLE booking_settings
  ADD COLUMN liff_heading_font TEXT NOT NULL DEFAULT 'default'
  CHECK (liff_heading_font IN ('default', 'serif', 'maru', 'sans'));
ALTER TABLE booking_settings
  ADD COLUMN liff_calendar_mode TEXT NOT NULL DEFAULT 'week_first'
  CHECK (liff_calendar_mode IN ('week_first', 'month_first', 'week_only', 'month_only'));
ALTER TABLE booking_settings
  ADD COLUMN liff_vacancy_dots INTEGER NOT NULL DEFAULT 1
  CHECK (liff_vacancy_dots IN (0, 1));

ALTER TABLE forms
  ADD COLUMN liff_appearance_mode TEXT NOT NULL DEFAULT 'inherit'
  CHECK (liff_appearance_mode IN ('inherit', 'custom'));
ALTER TABLE forms
  ADD COLUMN liff_theme TEXT NOT NULL DEFAULT 'line'
  CHECK (liff_theme IN ('natural', 'modern', 'gentle', 'night', 'line'));
ALTER TABLE forms
  ADD COLUMN liff_primary_color TEXT
  CHECK (liff_primary_color IS NULL OR liff_primary_color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]');
ALTER TABLE forms
  ADD COLUMN liff_background_color TEXT
  CHECK (liff_background_color IS NULL OR liff_background_color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]');
ALTER TABLE forms
  ADD COLUMN liff_heading_font TEXT NOT NULL DEFAULT 'default'
  CHECK (liff_heading_font IN ('default', 'serif', 'maru', 'sans'));
