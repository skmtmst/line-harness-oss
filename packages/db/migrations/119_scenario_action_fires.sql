-- 「発動2回目以降も各動作を実行する」を外したアクションの実行済み記録。
--
-- repeat_on_refire = 1 のときは一切書かない。書くと、毎回配信のたびに
-- 行が増えて、使わない記録でテーブルが太る。
CREATE TABLE IF NOT EXISTS scenario_action_fires (
  action_id TEXT NOT NULL REFERENCES scenario_actions (id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  fired_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (action_id, friend_id)
);
