-- カルーセルの選択肢に、押されたときの動きを持たせる。
--
-- いまの選択肢は「URLを開く」だけ。押した人にタグを付けたり、シナリオを
-- 始めたりできない。Lステップは選択肢ごとに「アクション設定」を持っていて、
-- 実運用ではそれが本体になっている（押した人を分けるために使う）。
--
-- **選択肢そのものの JSON には入れない。** columns は LINE へそのまま渡すので、
-- LINE が知らないフィールドを混ぜると弾かれる。別の列に持つ。
--
--   carousel_actions_json  { "0": { "0": [アクションの並び] } }
--                          パネルの番号 → 選択肢の番号 → 中身
--
-- 選択肢は postback になり、data に目印が入る（ctpl=<テンプレートid>&c=0&a=0）。
-- リッチメニューの rma=<areaId> と同じ形。webhook で剥がして実行する。
ALTER TABLE templates ADD COLUMN carousel_actions_json TEXT;

-- 選択肢が押された回数の制限（「カルーセル全体で1回のみ」）に使う。
--
-- リッチメニューの押された回数（148）と同じ作り。1回ごとに1行残す。
-- 「全体で1回」の判定は template_id + friend_id で1行でも見つかれば止める。
--
-- 外部キーは張らない。テンプレートを消しても、押された事実は残す。
CREATE TABLE IF NOT EXISTS carousel_taps (
  id              TEXT PRIMARY KEY,
  template_id     TEXT NOT NULL,
  column_index    INTEGER NOT NULL,
  action_index    INTEGER NOT NULL,
  action_label    TEXT,
  friend_id       TEXT,
  line_account_id TEXT,
  tapped_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 「この人がこのカルーセルを押したか」の判定。
CREATE INDEX IF NOT EXISTS idx_carousel_taps_friend ON carousel_taps(template_id, friend_id);
-- どの選択肢がよく押されたかの集計。
CREATE INDEX IF NOT EXISTS idx_carousel_taps_action ON carousel_taps(template_id, column_index, action_index);

-- 制限を超えたときの返し方。
--   tap_limit_mode  'none'（制限なし・既定）／'once'（カルーセル全体で1回）
--   tap_limit_text  超えたときに返すテキスト。空なら何も返さない。
ALTER TABLE templates ADD COLUMN carousel_tap_limit_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE templates ADD COLUMN carousel_tap_limit_text TEXT;
