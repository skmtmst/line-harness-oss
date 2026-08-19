-- シナリオの開始のきっかけ。
--
-- これまで scenarios.trigger_type / trigger_tag_id で1本につき1つしか
-- 持てなかった。「友だち追加でも始まるし、あとでタグが付いても始まる」を
-- 作れず、同じ内容のシナリオを複製することになっていた。
--
-- Lステップはシナリオ側にきっかけを持たず、呼ぶ側が指定する。そこまで
-- 一気に寄せると friend_scenarios の作られ方まで波及するので、まずは
-- **1本に複数のきっかけを持てる**ところまでにする。
--
--   friend_add … 友だち追加時
--   tag_added  … 決めたタグが付いたとき（tag_id を見る）
--
-- 「手動」はきっかけが無い状態なので、行を作らない。行が0本＝外から
-- 呼ばれたときだけ流れる、という意味になる。
CREATE TABLE IF NOT EXISTS scenario_triggers (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('friend_add', 'tag_added')),
  -- kind が 'tag_added' のときだけ入る。
  tag_id      TEXT REFERENCES tags (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
