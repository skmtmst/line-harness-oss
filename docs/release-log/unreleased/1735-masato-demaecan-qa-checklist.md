## 変更

- 出前館の通知について送信元IPで受け取りを制限できるようにした @masato #1735 2026-10-15 10:00
- デリバリー連携の失敗を運用の健康診断（API・外部連携）で見えるようにした @masato #1735 2026-10-15 10:00
- 出前館のQAチェック表13項目の回答台帳を `docs/integrations/demaecan-qa-checklist.md` に記録した @masato #1735 2026-10-15 10:00
- Uber Eats の接続先を Sandbox（テスト用アプリ）と本番で切り替えられるようにした。配備の設定 `RT_DELIVERY_UBEREATS_ENVIRONMENT` に `sandbox` を入れたときだけテスト側へ向け、未設定・`production` はこれまでと同じ本番側。書き間違いは本番へ落とさず連携の口を開けない @masato #1735 2026-10-15 10:00
