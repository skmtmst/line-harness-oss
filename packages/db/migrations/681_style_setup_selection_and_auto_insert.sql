-- B-313/B-324: retain deferred style selection and HQ automatic insertion preference.
ALTER TABLE account_styles ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'configured' CHECK(selection_mode IN ('configured','later','manual'));
UPDATE account_styles SET selection_mode='later' WHERE selected_at IS NULL;
ALTER TABLE style_starter_sets ADD COLUMN auto_insert INTEGER NOT NULL DEFAULT 1 CHECK(auto_insert IN (0,1));
