-- N-252: 成果地点を、履歴を保ったまま編集・新版化する。
--
-- 既存の stop / replace / delete は conversion_definition_operations へ記録するが、
-- あの表は前後の設定を持てない（列が無い）。編集は「何をどう変えたか」が
-- 監査の本体なので、前後の設定をそのまま控える専用の表を足す。
-- 既存表の CHECK は触らない（作り直しを避ける。additive-only）。
--
-- (conversion_point_id, to_version) を一意にして、同じ新版の記録が
-- 2行できないようにする。版CASと二重の守りにする。
CREATE TABLE IF NOT EXISTS conversion_definition_revisions (
  id                  TEXT PRIMARY KEY,
  conversion_point_id TEXT NOT NULL REFERENCES conversion_points(id) ON DELETE CASCADE,
  from_version        INTEGER NOT NULL CHECK (from_version > 0),
  to_version          INTEGER NOT NULL CHECK (to_version > from_version),
  before_config_json  TEXT NOT NULL CHECK (json_valid(before_config_json)),
  after_config_json   TEXT NOT NULL CHECK (json_valid(after_config_json)),
  affected_usages     INTEGER NOT NULL DEFAULT 0 CHECK (affected_usages >= 0),
  reason              TEXT,
  performed_by        TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  UNIQUE (conversion_point_id, to_version)
);

CREATE INDEX IF NOT EXISTS idx_conversion_definition_revisions_point
  ON conversion_definition_revisions(conversion_point_id, created_at DESC);

-- 計測したときの版を成果に控える。
--
-- 値の控え(value_snapshot, 移行271)だけでは「どの版で数えたか」が残らない。
-- 版を控えておけば、編集の前後で過去の成果がどの設定に属していたかを
-- 後から言える。
--
-- 既存行は NULL のままにする。いまの版で埋めると「計測時の版」を騙る。
-- 計測時に何版だったかは、もう分からない。
ALTER TABLE conversion_events ADD COLUMN point_version_snapshot INTEGER;
