-- カルーセルを通の種別として持てるようにする。
--
-- これまで carousel は flex に寄せていたが、**別物**だった。
-- カルーセルの中身は「columns の配列」で、Flex が要求するのは bubble か
-- carousel の**オブジェクト**。配列を渡すと LINE が 400 を返し、
-- 400 は永続エラー扱いなので、その人の購読ごと止まっていた。
--
-- 正しくは template メッセージ（type: 'template' / template.type: 'carousel'）。
-- 種別として持てば、テンプレートを消したあとの控えからも正しく組み立てられる。
--
-- SQLite は CHECK を後から変えられないので、また表を作り直す。
CREATE TABLE scenario_steps_new (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  delay_minutes   INTEGER NOT NULL DEFAULT 0,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel')),
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
