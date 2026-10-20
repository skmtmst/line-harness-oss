> 文書：tag-edit のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# タグ：タグの編集・保存した検索の編集の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/tags/edit` → [app/tags/edit/page.tsx](../../app/tags/edit/page.tsx)
- `/tags/searches/edit` → [app/tags/searches/edit/page.tsx](../../app/tags/searches/edit/page.tsx)

本体：[edit.tsx](edit.tsx)、[search-edit.tsx](search-edit.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`TagEditV8`・`TagEditForm`・`SavedSearchEditV8`
- [public/edit/index.ts](public/edit/index.ts)：`TagEditForm`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [edit-form-validation.test.tsx](edit-form-validation.test.tsx)
- [edit-target-regression.test.tsx](edit-target-regression.test.tsx)
- [model.test.ts](model.test.ts)
- [retroactive-close.test.tsx](retroactive-close.test.tsx)
- [search-read-failure.test.tsx](search-read-failure.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/tag-edit`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
