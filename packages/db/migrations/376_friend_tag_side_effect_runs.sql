-- タグ付与の工程別台帳(#699)。
--
-- friend_tags への INSERT OR IGNORE が先に確定するため、そのあとに走る
-- マイル記録・tag_added シナリオ登録・tag_change 発火が落ちると、次回
-- 同じ経路へ来ても changes=0 で早期 return し、その副作用は二度と走らない。
-- 「タグ付与は済んだが後続の副作用は未了」という状態を表す行をここに置き、
-- 未了のものだけを走り直せるようにする。
--
-- 工程(step_key)は付与のたびに固定の3本を開く。付与の直後に3本まとめて
-- 開くので、1本目の副作用が落ちても「何が未了か」は台帳に残る。
--   mileage          … enqueueMileageEvent
--   scenario_enroll  … getTagAddedScenarioIds + enrollFriendInScenario の一巡
--   event_tag_change … fireEvent('tag_change')
--
-- assigned_at は friend_tags の付与時刻をそのまま写す。マイルの冪等キーが
-- この時刻を含むため、走り直しで時刻を取り直すと同じ出来事が二重に積まれる。
-- 走り直しは必ずこの列の時刻を使う。
--
-- 主キーは (friend_id, tag_id, step_key)。タグを外してから付け直したときは
-- 新しい出来事なので、同じ行を assigned_at ごと pending へ戻して再利用する。
--
-- status の意味と、走り直してよいかの判断:
--   pending    … 開いただけ。まだ一度も走っていないので、走り直してよい。
--   running    … 走り始めた印。結末が分からない(処理ごと消えた等)。
--                 冪等な工程(mileage / scenario_enroll)だけ走り直してよい。
--                 tag_change は冪等でないため走り直さず、人が見る印として残す。
--   failed     … 走って落ちた。last_error に理由が残る。走り直してよい。
--   completed  … 済。二度と走らせない。
--
-- 失敗は呼び出し口の .catch で握り潰されることがある。この表に残る failed /
-- running の行が、運用者が「何が走らなかったか」を知る手がかりになる。
CREATE TABLE IF NOT EXISTS friend_tag_side_effect_runs (
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  tag_id          TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  step_key        TEXT NOT NULL
                    CHECK (step_key IN ('mileage', 'scenario_enroll', 'event_tag_change')),
  assigned_at     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'failed', 'completed')),
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error      TEXT,
  last_attempt_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (friend_id, tag_id, step_key)
);

-- 運用者が「いま未了のものは何か」を古い順に引くための索引。
CREATE INDEX IF NOT EXISTS idx_friend_tag_side_effect_runs_unfinished
  ON friend_tag_side_effect_runs(status, updated_at);
