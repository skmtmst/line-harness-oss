> 文書：auto-replies のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 自動応答一覧の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/auto-replies/edit` → [app/auto-replies/edit/page.tsx](../../app/auto-replies/edit/page.tsx)
- `/auto-replies` → [app/auto-replies/page.tsx](../../app/auto-replies/page.tsx)
- `/auto-replies/runs` → [app/auto-replies/runs/page.tsx](../../app/auto-replies/runs/page.tsx)

本体：[edit/wizard.tsx](edit/wizard.tsx)、[list.tsx](list.tsx)、[runs.tsx](runs.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`AutoReplyWizardV8`・`AutoRepliesListV8`・`AutoReplyRunsV8`・`MESSAGE_KIND_WORDS`・`messageKindWord`・`responseTypeWord`
- [public/auto-reply-words/index.ts](public/auto-reply-words/index.ts)：`MESSAGE_KIND_WORDS`・`messageKindWord`・`responseTypeWord`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [bulk-retry-failure.test.tsx](bulk-retry-failure.test.tsx)
- [list.test.tsx](list.test.tsx)
- [order.test.ts](order.test.ts)
- [quick-create.test.tsx](quick-create.test.tsx)
- [runs.test.ts](runs.test.ts)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/auto-replies`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
