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
-- ## status は「何が起きたか」の記録で、「走り直してよいか」の判断材料ではない
--
--   pending   … 走り始めの印が一度も立っていない。
--   running   … 走り始めた。
--   failed    … 例外が呼び出し口まで届いた。last_error に理由が残る。
--   completed … 済。二度と走らせない。
--
-- running の印は副作用のひとつ手前で立つ。だから running と failed の違いは
-- 「例外が届いたかどうか」だけで、**どこまで外へ出たかについては同じ情報量
-- しか持たない**。
--
-- 例: fireEvent('tag_change') は Phase 1(送信 webhook + 加点)を
-- Promise.allSettled で済ませたあと、その先(getFriendScore など)で落ちること
-- がある。このとき加点も webhook も外へ出ているのに status は failed になる。
-- failed を「走らなかった」と読むと、走り直しで同じ人へ二重に届く。
--
-- そこで**走り直してよいかは status ではなく工程で決める**。正本は
-- packages/db/src/friend-tag-side-effects.ts の
-- FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM。
--
--   mileage          … pending / running / failed から走り直す(冪等キー)
--   scenario_enroll  … pending / running / failed から走り直す(存在確認 +
--                      idx_friend_scenarios_unique)
--   event_tag_change … pending からだけ。外へ出る工程なので、running /
--                      failed は「出たかもしれない」と読み、走り直さない。
--                      人が「出ていない」と確かめたときだけ
--                      reopenFriendTagSideEffectRun で pending へ戻す。
--
-- pending が安全なのは、走り始めの印を立てる UPDATE(予約)が
-- pending → running を1回の条件付き UPDATE で行うため。pending のまま残った
-- 行は確実に一度も走っていない。
--
-- 外へ出る工程を不明なまま送り直さないのは、この repo の既定に合わせたもの。
-- migration 375 の needs_reconcile(送達不明は送り直さない)、358 の
-- dispatched_at(印が残っていれば送ったかもしれない)と同じ考え方。
--
-- ## 予約(誰が走らせるか)
--
-- status を running へ進める UPDATE の WHERE に、工程ごとの遷移元と試行回数の
-- 上限を入れている。changes=1 を取れた呼び出しだけが副作用へ進む。判断(読み)と
-- 占有(書き)を分けると、同時に来た2本が同じ工程を走らせる。
--
-- ## 止まっている行
--
-- 自動で走り直さない行(event_tag_change の running / failed、上限に達した行)は
-- 放っておくと永久に欠けたままになる。countStuckFriendTagSideEffectRuns /
-- listStuckFriendTagSideEffectRuns で数えて見られるようにし、止まった時点で
-- 通知センターへ1件残す。
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

-- 止まっている行・未了の行を古い順に引くための索引。
CREATE INDEX IF NOT EXISTS idx_friend_tag_side_effect_runs_unfinished
  ON friend_tag_side_effect_runs(status, updated_at);
