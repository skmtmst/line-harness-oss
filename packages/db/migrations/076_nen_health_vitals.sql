-- Add home-measured vital signs to the NEN health diary.
ALTER TABLE nen_health_logs ADD COLUMN heart_rate_bpm INTEGER;
ALTER TABLE nen_health_logs ADD COLUMN respiratory_rate_bpm INTEGER;
