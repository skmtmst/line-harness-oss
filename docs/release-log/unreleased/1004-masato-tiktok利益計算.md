# TikTok利益計算の自動集計（第2段・API連携）

## 追加
- TikTok利益計算シートの自動作成と差分同期（migration 514、cron「tiktok pnl sync」、services/tiktok-pnl.ts） @masato #1004 2026-09-29 12:49
- TikTok利益計算の状態確認・手動同期API（GET /api/integrations/tiktok-pnl/status、POST /api/integrations/tiktok-pnl/sync、監査 tiktok_pnl.manual_sync） @masato #1004 2026-09-29 12:49
- TikTok利益計算の設計文書とEC-CUBE側エンドポイント仕様（docs/tiktok-pnl/design.md、親リポジトリは未変更） @masato #1004 2026-09-29 12:49

## 変更
- OpenAPI・権限スナップショット・FEATURE_JOB_MANIFESTへtiktok-pnl系を追記 @masato #1004 2026-09-29 12:49
