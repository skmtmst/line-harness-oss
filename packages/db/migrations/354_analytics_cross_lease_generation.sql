-- クロス分析の実行権は世代で管理する。期限切れ回収でrunningをpendingへ
-- 戻しても、旧実行の完了・失敗が新実行の結果を上書きしないよう、claim・
-- 完了・失敗を同じ世代条件(lease_generation)で更新する。
ALTER TABLE analytics_cross_runs ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0;
