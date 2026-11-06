> 文書：hq-templates のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 統括のテンプレートの動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/hq/form-submissions` → [app/hq/form-submissions/page.tsx](../../app/hq/form-submissions/page.tsx)
- `/hq/friend-attributes` → [app/hq/friend-attributes/page.tsx](../../app/hq/friend-attributes/page.tsx)
- `/hq/rich-menus` → [app/hq/rich-menus/page.tsx](../../app/hq/rich-menus/page.tsx)
- `/hq/templates` → [app/hq/templates/page.tsx](../../app/hq/templates/page.tsx)

本体：[console.tsx](console.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`HqTemplatesV8`・`hostDefinition`・`HqTagEditorV8`・`useDistributionFolders`・`accountsInFolder`・`distributionFolderRows`・`SavedDistributionDialog`・`hqTemplateTabsForStarterSets`
- [public/console/index.ts](public/console/index.ts)：`HqTemplatesV8`・`hostDefinition`
- [public/distribution-accounts/index.ts](public/distribution-accounts/index.ts)：`accountsInFolder`・`distributionFolderRows`・`useDistributionFolders`
- [public/saved-distribution-dialog/index.ts](public/saved-distribution-dialog/index.ts)：`SavedDistributionDialog`
- [public/store-list/index.ts](public/store-list/index.ts)：`hqTemplateTabsForStarterSets`
- [public/tag-editor/index.ts](public/tag-editor/index.ts)：`HqTagEditorV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/feature-wait.ts](../../lib/api/helpers/feature-wait.ts)
- [lib/api/helpers/hq-distribution-targets.ts](../../lib/api/helpers/hq-distribution-targets.ts)
- [lib/api/helpers/hq-media.ts](../../lib/api/helpers/hq-media.ts)
- [lib/hq-friend-attributes-api.ts](../../lib/hq-friend-attributes-api.ts)
- [lib/hq-templates-api.ts](../../lib/hq-templates-api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [attribute-tabs.test.tsx](attribute-tabs.test.tsx)
- [attributes.test.tsx](attributes.test.tsx)
- [console-crumbs.test.tsx](console-crumbs.test.tsx)
- [console-tag-folder.test.tsx](console-tag-folder.test.tsx)
- [console.test.tsx](console.test.tsx)
- [definition.test.ts](definition.test.ts)
- [distribution-accounts.test.tsx](distribution-accounts.test.tsx)
- [folder-color.test.tsx](folder-color.test.tsx)
- [folder-distribution.test.ts](folder-distribution.test.ts)
- [list-row.test.ts](list-row.test.ts)
- [message-form.test.tsx](message-form.test.tsx)
- [saved-distribution-layout.test.tsx](saved-distribution-layout.test.tsx)
- [store-list.test.tsx](store-list.test.tsx)
- [tag-editor.test.tsx](tag-editor.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/hq-templates`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
