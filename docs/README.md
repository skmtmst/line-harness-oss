# 文書の入口

何を知りたいかで、下の文書を選んでください。動きの要件は要件の索引、見た目は画面ごとの Pencil ★V8 と見た目の決まりに従います。

| 知りたいこと | 読む文書 |
| --- | --- |
| 作業の決まり・引き継ぎ | [AGENTS.md](../AGENTS.md) → [Memory](brain/Memory.md) → [訂正](brain/rules/corrections.md) → [再発防止](brain/rules/mistakes.md) |
| 開発の構成・手元での検査 | [開発ガイド](development.md)・[環境の検査](codex-cloud-environment.md) |
| 機能の動きと合格条件 | [34機能と横断契約の索引](v6-requirements/v6-requirements-master-index.md)・[追加機能の索引](v8-requirements/README.md) |
| 画面の見た目・型・変更先 | [見た目の決まり](v8-design-rules.md)・[型の対応表](v8-pattern-catalog.md)・[画面の書き方](../apps/web/src/v8/README.md) |
| 本番への切り替え条件 | [V8切り替え](v8-requirements/v8-switch.md) |
| 検証環境・配備・DB更新 | [検証環境](NEN-LINE-STAGING.md)・[配備ゲート](DEPLOY-GATE.md)・[DB更新手順](migration-runbook.md) |
| ログイン・権限・LINE接続 | [認証](ADMIN-AUTH.md)・[権限](organization-account-access-policy.md)・[LINE登録](line-account-register.md)・[鍵の移行](line-credential-encryption.md) |
| APIの呼び方・統括からの配布 | [統括API](api/headquarters.md)・[LINEプロキシ](LINE-API-PROXY.md)・[SDK](../packages/sdk/README.md) |
| 飲食店の予約・休業・来店 | [予約API](api/restaurant-booking.md)・[来店とスタンプ](api/visits-and-stamps.md)・[分離境界](restaurant-test-architecture.md) |
| 下書き・会話検索・Instagram | [接続API](api/drafts-and-instagram.md)・[Metaの設定](instagram-meta-app-setup.md) |
| 集計・広告・通知のAPI | [設定と計測](api/operations-and-measurement.md) |
| Google・デリバリーの外部設定 | [Google設定](manuals/google-business-oauth-setup.md)・[Sheets設定](manuals/google-sheets-oauth-setup.md)・[デリバリー接続](integrations/delivery-api-inquiry.md)・[フェーズ2の受け皿](restaurant-delivery-phase2-slots.md) |
| 運営のお問い合わせ・AI | [運営コンソール](ops-console.md)・[受信設定](support-inbox-setup.md) |
| 保存が失敗した時の表示 | [欄ごとのエラー](form-save-errors.md) |
| Slackでの共同開発・報告 | [共同開発とPR同期](codex-slack-sync.md)・[完了報告](slack-report-to-claude.md) |
| 更新履歴の追加・版へのまとめ | [書き方](release-log/README.md)・[設計](change-log-design.md) |
| 他サービスとの比較 | [Lステップ・Linyの調査](lstep-liny-screen-behavior-research-2026-08.md)・[未確認の想定](lstep-unverified-assumptions.md) |
