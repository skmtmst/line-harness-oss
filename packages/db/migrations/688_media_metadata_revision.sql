-- Metadata edits use a separate revision from file replacement versions.
ALTER TABLE media ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
