-- NEN AI consultation: source-attributed knowledge and free-text consultation logs.
CREATE TABLE IF NOT EXISTS nen_knowledge_articles (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  animal_type TEXT NOT NULL CHECK (animal_type IN ('dog','cat','all')),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nen_knowledge_animal ON nen_knowledge_articles(animal_type, is_active);

CREATE TABLE nen_consultation_logs_v2 (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  pet_id TEXT REFERENCES nen_pet_profiles(id) ON DELETE SET NULL,
  animal_type TEXT NOT NULL DEFAULT 'dog' CHECK (animal_type IN ('dog','cat')),
  topic TEXT NOT NULL DEFAULT 'free_text',
  question_text TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers_json)),
  result_key TEXT NOT NULL,
  result_text TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
  safety_level TEXT NOT NULL DEFAULT 'general' CHECK (safety_level IN ('general','caution','urgent')),
  created_at TEXT NOT NULL
);

INSERT INTO nen_consultation_logs_v2
  (id, friend_id, pet_id, animal_type, topic, question_text, answers_json, result_key, result_text, tag_name, tags_json, source_ids_json, safety_level, created_at)
SELECT id, friend_id, pet_id, 'dog', topic, '', answers_json, result_key, result_text, tag_name,
       json_array(tag_name), '[]', 'general', created_at
  FROM nen_consultation_logs;

-- Keep the original table as a recoverable archive. The application switches
-- to v2 after this additive copy instead of dropping or renaming live data.
CREATE INDEX IF NOT EXISTS idx_nen_consultations_v2_friend ON nen_consultation_logs_v2(friend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nen_consultations_v2_safety ON nen_consultation_logs_v2(safety_level, created_at DESC);
