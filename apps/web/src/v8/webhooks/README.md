> 文書：webhooks のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 外部連携（V8）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/webhooks/edit` → [app/webhooks/edit/page.tsx](../../app/webhooks/edit/page.tsx)
- `/webhooks/new` → [app/webhooks/new/page.tsx](../../app/webhooks/new/page.tsx)
- `/webhooks` → [app/webhooks/page.tsx](../../app/webhooks/page.tsx)

本体：[api-tokens.tsx](api-tokens.tsx)、[create.tsx](create.tsx)、[edit.tsx](edit.tsx)、[incoming.tsx](incoming.tsx)、[interactions.tsx](interactions.tsx)、[outgoing.tsx](outgoing.tsx)、[samples.tsx](samples.tsx)、[sheets.tsx](sheets.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`WebhooksCreateV8`・`WebhooksOutgoingV8`・`WebhooksInteractionsV8`・`WebhooksIncomingV8`・`WebhooksApiTokensV8`・`WebhooksSheetsV8`・`WebhooksSamplesV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [api-tokens.test.ts](api-tokens.test.ts)
- [create-draft-stop.test.tsx](create-draft-stop.test.tsx)
- [edit-authorization.test.tsx](edit-authorization.test.tsx)
- [incoming-actions.test.tsx](incoming-actions.test.tsx)
- [rotate-saving.test.tsx](rotate-saving.test.tsx)
- [secret.test.ts](secret.test.ts)
- [sheets-sync.test.ts](sheets-sync.test.ts)
- [summary-period.test.ts](summary-period.test.ts)
- [webhooks.test.tsx](webhooks.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/webhooks`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
