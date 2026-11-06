-- 草稿: 番号・適用ともオーナー承認待ち。D1 には適用しない。
CREATE TABLE mileage_reward_folders (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_mileage_reward_folders_account ON mileage_reward_folders(line_account_id, display_order);
ALTER TABLE mileage_rewards ADD COLUMN folder_id TEXT REFERENCES mileage_reward_folders(id);
CREATE INDEX idx_mileage_rewards_folder ON mileage_rewards(line_account_id, folder_id);
