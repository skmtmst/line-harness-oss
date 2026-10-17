-- 候補544 rollback（論理rollback第一案。列・表は残す）
--
-- 方針: 実データ入り後は物理的な列削除・表作り直しをしない。
-- 第一案は論理rollback（flag OFF＋参照停止）。列は残す。
-- 物理復元は別承認・保守時間・後続書込保全が条件のバックアップ復元のみ。
-- 短いSQLで安全に戻せるとは言わない。
--
-- 手順:
--   1. tenant設定 feature.v8_company_branding を OFF（全tenant）。
--      公開看板は汎用musubo看板へ戻る。
--   2. logo参照の新規設定を停止（commit-logo口を閉じる）。
--   3. 下の確認クエリで新規列の利用状況を見る。
--   4. 物理復元が必要な場合は、適用前の D1 エクスポートからの
--      復元を別承認・保守時間・後続書込の保全確認の上で行う。

-- 確認（読取のみ。実行安全）:
SELECT COUNT(*) AS tenants_with_display
FROM tenants
WHERE display_name IS NOT NULL OR login_display_name IS NOT NULL
   OR logo_asset_id IS NOT NULL OR brand_slug IS NOT NULL;
SELECT COUNT(*) AS logo_assets_kept FROM tenant_logo_assets;
