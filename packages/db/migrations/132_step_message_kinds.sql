-- 送れるメッセージの種別を増やす。
--
--   これまで … text / image / flex
--   これから … + location（位置情報）/ video（動画）/ audio（音声）/ sticker（スタンプ）
--
-- SQLite は CHECK 制約を後から変えられないので、表を作り直して移す。
-- 列と索引は現物（bootstrap.sql）に合わせてある。増減があると、移した
-- 時点で静かに欠ける。
--
-- 'carousel' は入れない。LINE のカルーセルは Flex の一種で、flex として
-- 送る。別の種別にすると、配信側で同じものを2通りに扱うことになる。
CREATE TABLE scenario_steps_new (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  delay_minutes   INTEGER NOT NULL DEFAULT 0,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker')),
  message_content TEXT NOT NULL,
  message_bubbles_json TEXT CHECK (message_bubbles_json IS NULL OR json_valid(message_bubbles_json)),
  offset_days     INTEGER,
  offset_minutes  INTEGER,
  delivery_time   TEXT,
  template_id     TEXT REFERENCES templates(id) ON DELETE SET NULL,
  on_reach_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  condition_type  TEXT,
  condition_value TEXT,
  next_step_on_false INTEGER,
  after_send      TEXT NOT NULL DEFAULT 'continue' CHECK (after_send IN ('continue', 'pause')),
  target_condition_json TEXT,
  question_json   TEXT,
  is_draft        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scenario_id, step_order)
);
