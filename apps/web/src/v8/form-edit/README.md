> 文書：form-edit のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 回答フォームの編集の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/form-submissions/edit` → [app/form-submissions/edit/page.tsx](../../app/form-submissions/edit/page.tsx)

本体：[edit.tsx](edit.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`FormEditV8`・`FormPhone`・`AppearanceTab`・`FormEditHost`
- [phone/index.ts](phone/index.ts)：`FormPhone`
- [public/appearance-tab/index.ts](public/appearance-tab/index.ts)：`AppearanceTab`
- [public/edit/index.ts](public/edit/index.ts)：`FormEditV8`
- [public/host/index.ts](public/host/index.ts)：`FormEditHost`
- [public/phone/index.ts](public/phone/index.ts)：`FormPhone`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [add-blocks.test.tsx](add-blocks.test.tsx)
- [add-default-label.test.ts](add-default-label.test.ts)
- [after-tab-reorder.test.tsx](after-tab-reorder.test.tsx)
- [appearance-tab.test.tsx](appearance-tab.test.tsx)
- [edit.test.tsx](edit.test.tsx)
- [fixed-fields.test.ts](fixed-fields.test.ts)
- [header-entry.test.tsx](header-entry.test.tsx)
- [page-delete.test.tsx](page-delete.test.tsx)
- [routing-model.test.ts](routing-model.test.ts)
- [save-destinations.test.tsx](save-destinations.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/form-edit`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
