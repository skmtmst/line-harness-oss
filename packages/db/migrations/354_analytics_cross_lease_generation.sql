-- クロス分析の実行権は世代で管理する。期限切れ回収でrunningをpendingへ
-- 戻しても、旧実行の完了・失敗が新実行の結果を上書きしないよう、claim・
-- 完了・失敗を同じ世代条件(lease_generation)で更新する。
ALTER TABLE analytics_cross_runs ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0;

-- 確定した結果がどの世代の対象者行に対応するかを持つ。読み取り(対象者の作成)は
-- この世代だけを見るため、回収後に生き返った旧実行が対象者行を書いても混ざらない。
-- 移行前に完了していた行はNULLのままで、既存の対象者行(世代0)と対応する。
ALTER TABLE analytics_cross_runs ADD COLUMN result_generation INTEGER;

-- 対象者行を世代別のstagingにする。旧実行と新実行が同時に書いても主キーが
-- 衝突せず、互いの行を消さない。確定した世代だけを読み、負けた世代は確定後に
-- 片付ける。主キーの変更はSQLiteでは作り直しになる。
ALTER TABLE analytics_cross_run_members RENAME TO analytics_cross_run_members_v1;
DROP INDEX IF EXISTS idx_analytics_cross_members_selection;

CREATE TABLE analytics_cross_run_members (
  run_id           TEXT NOT NULL REFERENCES analytics_cross_runs(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  row_key          TEXT NOT NULL,
  col_key          TEXT NOT NULL,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, lease_generation, row_key, col_key, friend_id)
);

CREATE INDEX idx_analytics_cross_members_selection
  ON analytics_cross_run_members(run_id, lease_generation, row_key, col_key, friend_id);

INSERT INTO analytics_cross_run_members (
  run_id, line_account_id, lease_generation, row_key, col_key, friend_id
)
SELECT run_id, line_account_id, 0, row_key, col_key, friend_id
  FROM analytics_cross_run_members_v1;

DROP TABLE analytics_cross_run_members_v1;
