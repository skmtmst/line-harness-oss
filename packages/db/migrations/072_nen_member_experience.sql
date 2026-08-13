-- NEN LINE member experience: multi-pet profile, health diary, EC snapshot,
-- photo review/points and deterministic food-education consultation.
ALTER TABLE nen_pet_profiles ADD COLUMN breed TEXT;
ALTER TABLE nen_pet_profiles ADD COLUMN weight_kg REAL;
ALTER TABLE nen_pet_profiles ADD COLUMN concerns TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(concerns));
ALTER TABLE nen_pet_profiles ADD COLUMN recommended_daily_grams INTEGER;
ALTER TABLE nen_pet_profiles ADD COLUMN recommended_daily_min_grams INTEGER;
ALTER TABLE nen_pet_profiles ADD COLUMN recommended_daily_max_grams INTEGER;
ALTER TABLE nen_pet_profiles ADD COLUMN venison_daily_grams INTEGER;
ALTER TABLE nen_pet_profiles ADD COLUMN food_cycle_days INTEGER;

CREATE TABLE IF NOT EXISTS nen_health_logs (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  logged_on TEXT NOT NULL,
  weight_kg REAL,
  stool_status TEXT NOT NULL CHECK (stool_status IN ('normal','soft','hard','diarrhea','bloody','other')),
  appetite TEXT NOT NULL CHECK (appetite IN ('good','normal','poor')),
  skin_status TEXT NOT NULL DEFAULT 'normal' CHECK (skin_status IN ('normal','itchy','red','other')),
  tear_stain_status TEXT NOT NULL DEFAULT 'normal' CHECK (tear_stain_status IN ('normal','mild','concern')),
  note TEXT NOT NULL DEFAULT '',
  care_flag INTEGER NOT NULL DEFAULT 0 CHECK (care_flag IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (pet_id, logged_on)
);
CREATE INDEX IF NOT EXISTS idx_nen_health_logs_pet_date ON nen_health_logs(pet_id, logged_on DESC);

CREATE TABLE IF NOT EXISTS nen_care_flags (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL CHECK (flag_type IN ('poor_appetite','abnormal_stool')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved')),
  consecutive_days INTEGER NOT NULL DEFAULT 0,
  advice_ready INTEGER NOT NULL DEFAULT 1 CHECK (advice_ready IN (0,1)),
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (pet_id, flag_type)
);
CREATE INDEX IF NOT EXISTS idx_nen_care_flags_status ON nen_care_flags(status, detected_at DESC);

CREATE TABLE IF NOT EXISTS nen_ec_member_snapshots (
  friend_id TEXT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
  customer_id TEXT,
  orders_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(orders_json)),
  subscription_json TEXT CHECK (subscription_json IS NULL OR json_valid(subscription_json)),
  purchase_count INTEGER NOT NULL DEFAULT 0,
  purchase_amount INTEGER NOT NULL DEFAULT 0,
  point_balance INTEGER NOT NULL DEFAULT 0,
  member_rank TEXT NOT NULL DEFAULT '会員',
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nen_member_rank ON nen_ec_member_snapshots(member_rank, purchase_amount DESC);

CREATE TABLE IF NOT EXISTS nen_photo_submissions (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES nen_pet_profiles(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  content_type TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','adopted','rejected')),
  awarded_points INTEGER NOT NULL DEFAULT 0,
  point_transaction_id TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nen_photos_status ON nen_photo_submissions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS nen_consultation_logs (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  pet_id TEXT REFERENCES nen_pet_profiles(id) ON DELETE SET NULL,
  topic TEXT NOT NULL CHECK (topic IN ('tear_stain','appetite','allergy')),
  answers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers_json)),
  result_key TEXT NOT NULL,
  result_text TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nen_consultations_friend ON nen_consultation_logs(friend_id, created_at DESC);
