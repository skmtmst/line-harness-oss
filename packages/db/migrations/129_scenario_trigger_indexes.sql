-- 友だち追加のたび、タグが付くたびに引くので、その形の索引を置く。
-- 同じきっかけを二重に登録できないようにもする。
CREATE UNIQUE INDEX IF NOT EXISTS idx_scenario_triggers_unique
  ON scenario_triggers (scenario_id, kind, COALESCE(tag_id, ''));
