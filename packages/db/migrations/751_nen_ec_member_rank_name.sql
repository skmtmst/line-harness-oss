-- Preserve only names explicitly supplied by EC; existing rows remain unknown.
ALTER TABLE nen_ec_member_snapshots ADD COLUMN ec_member_rank_name TEXT;
