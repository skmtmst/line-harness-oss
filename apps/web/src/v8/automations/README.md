> 文書：automations のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# オートメーション（V8）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/automations/drafts` → [app/automations/drafts/page.tsx](../../app/automations/drafts/page.tsx)
- `/automations/new` → [app/automations/new/page.tsx](../../app/automations/new/page.tsx)
- `/automations` → [app/automations/page.tsx](../../app/automations/page.tsx)
- `/automations/runs` → [app/automations/runs/page.tsx](../../app/automations/runs/page.tsx)
- `/common-actions/edit` → [app/common-actions/edit/page.tsx](../../app/common-actions/edit/page.tsx)
- `/common-actions/new` → [app/common-actions/new/page.tsx](../../app/common-actions/new/page.tsx)
- `/common-actions` → [app/common-actions/page.tsx](../../app/common-actions/page.tsx)
- `/common-actions/versions` → [app/common-actions/versions/page.tsx](../../app/common-actions/versions/page.tsx)

本体：[common-action-edit.tsx](common-action-edit.tsx)、[common-action-new.tsx](common-action-new.tsx)、[common-actions.tsx](common-actions.tsx)、[create/create.tsx](create/create.tsx)、[definition-entry.tsx](definition-entry.tsx)、[list.tsx](list.tsx)、[runs.tsx](runs.tsx)、[templates.tsx](templates.tsx)、[versions.tsx](versions.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`NewAutomationV8`・`AutomationDefinitionEntry`・`AutomationListV8`・`AutomationTemplatesV8`・`AutomationRunsV8`・`CommonActionNew`・`CommonActionsV8`・`CommonActionVersionsV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [create/BEHAVIOR.md](create/BEHAVIOR.md)
- [common-action-new.test.ts](common-action-new.test.ts)
- [common-action-validation.test.tsx](common-action-validation.test.tsx)
- [create/draft-keep.test.ts](create/draft-keep.test.ts)
- [create/validation.test.tsx](create/validation.test.tsx)
- [definition-entry.test.tsx](definition-entry.test.tsx)
- [list.test.tsx](list.test.tsx)
- [templates.test.tsx](templates.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/automations`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
