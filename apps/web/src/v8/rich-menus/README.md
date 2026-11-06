> 文書：rich-menus のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# リッチメニュー一覧の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/hq/rich-menus` → [app/hq/rich-menus/page.tsx](../../app/hq/rich-menus/page.tsx)
- `/rich-menus/connections` → [app/rich-menus/connections/page.tsx](../../app/rich-menus/connections/page.tsx)
- `/rich-menus/edit` → [app/rich-menus/edit/page.tsx](../../app/rich-menus/edit/page.tsx)
- `/rich-menus/new` → [app/rich-menus/new/page.tsx](../../app/rich-menus/new/page.tsx)
- `/rich-menus` → [app/rich-menus/page.tsx](../../app/rich-menus/page.tsx)

本体：[connections.tsx](connections.tsx)、[list.tsx](list.tsx)、[new/create.tsx](new/create.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`RichMenuCreateV8`・`RichMenuConnectionsV8`・`RichMenusListV8`・`richMenuError`・`richMenuErrorAll`・`unpublishWarningText`
- [public/errors/index.ts](public/errors/index.ts)：`richMenuError`・`richMenuErrorAll`・`unpublishWarningText`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/hq-authoring.ts](../../lib/api/helpers/hq-authoring.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [connections-indirect.test.ts](connections-indirect.test.ts)
- [delete-impact.test.ts](delete-impact.test.ts)
- [errors.test.ts](errors.test.ts)
- [external-import-switch.test.ts](external-import-switch.test.ts)
- [list-reorder-all.test.tsx](list-reorder-all.test.tsx)
- [list.test.tsx](list.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/rich-menus`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
