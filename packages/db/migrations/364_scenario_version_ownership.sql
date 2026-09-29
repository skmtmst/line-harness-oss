-- N-050 再審査: 版の帰属制約。公開版の指針と購読の版固定は、必ず
-- 同じシナリオの版を指す。351 の単列参照だけでは別シナリオの版IDを
-- 指せてしまい、配信がよそのシナリオの文面を読む汚染が起きる。
-- 書き換え・復帰・削除の不変条件は 351 のトリガーが持つ。ここは
-- 「誰の版か」だけを見て、違う持ち主なら止める。

CREATE TRIGGER IF NOT EXISTS trg_scenarios_pointer_ownership
BEFORE UPDATE OF current_published_version_id ON scenarios
WHEN NEW.current_published_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM scenario_versions
   WHERE id = NEW.current_published_version_id AND scenario_id = NEW.id
 )
BEGIN SELECT RAISE(ABORT, 'published version belongs to another scenario'); END;

CREATE TRIGGER IF NOT EXISTS trg_friend_scenarios_version_ownership_insert
BEFORE INSERT ON friend_scenarios
WHEN NEW.published_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM scenario_versions
   WHERE id = NEW.published_version_id AND scenario_id = NEW.scenario_id
 )
BEGIN SELECT RAISE(ABORT, 'published version belongs to another scenario'); END;

CREATE TRIGGER IF NOT EXISTS trg_friend_scenarios_version_ownership_update
BEFORE UPDATE OF published_version_id ON friend_scenarios
WHEN NEW.published_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM scenario_versions
   WHERE id = NEW.published_version_id AND scenario_id = NEW.scenario_id
 )
BEGIN SELECT RAISE(ABORT, 'published version belongs to another scenario'); END;
