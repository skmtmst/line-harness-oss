> 文書：tags のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# タグ（src/v8/tags）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/tags/fields/edit` → [app/tags/fields/edit/page.tsx](../../app/tags/fields/edit/page.tsx)
- `/tags/fields/migrate` → [app/tags/fields/migrate/page.tsx](../../app/tags/fields/migrate/page.tsx)
- `/tags/fields/new` → [app/tags/fields/new/page.tsx](../../app/tags/fields/new/page.tsx)
- `/tags/folders/new` → [app/tags/folders/new/page.tsx](../../app/tags/folders/new/page.tsx)
- `/tags/marks/edit` → [app/tags/marks/edit/page.tsx](../../app/tags/marks/edit/page.tsx)
- `/tags/marks/new` → [app/tags/marks/new/page.tsx](../../app/tags/marks/new/page.tsx)
- `/tags/new` → [app/tags/new/page.tsx](../../app/tags/new/page.tsx)
- `/tags` → [app/tags/page.tsx](../../app/tags/page.tsx)

本体：[create.tsx](create.tsx)、[field-edit.tsx](field-edit.tsx)、[field-migrate.tsx](field-migrate.tsx)、[field-new.tsx](field-new.tsx)、[folder-page.tsx](folder-page.tsx)、[list.tsx](list.tsx)、[mark-editor.tsx](mark-editor.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`FieldEdit`・`FieldMigrateV8`・`FieldNew`・`TagFolderPageV8`・`MarkEditor`・`TagCreateV8`・`TagsList`・`FieldsTab`・`FieldEditor`・`FieldEditorValues`・`markNameRequirement`・`MarksTab`・`MarkBasicFields`・`AttributeListHost`・`DEFAULT_TAG_FOLDER_COLOR`・`tagNameProblem`
- [public/attribute-host/index.ts](public/attribute-host/index.ts)：`AttributeListHost`
- [public/field-editor/index.ts](public/field-editor/index.ts)：`FieldEditorValues`・`FieldEditor`
- [public/fields-tab/index.ts](public/fields-tab/index.ts)：`FieldsTab`
- [public/folder-colors/index.ts](public/folder-colors/index.ts)：`DEFAULT_TAG_FOLDER_COLOR`
- [public/mark-basic-fields/index.ts](public/mark-basic-fields/index.ts)：`MarkBasicFields`
- [public/mark-requirement/index.ts](public/mark-requirement/index.ts)：`markNameRequirement`
- [public/marks-tab/index.ts](public/marks-tab/index.ts)：`MarksTab`
- [public/tag-name/index.ts](public/tag-name/index.ts)：`tagNameProblem`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [create-validation.test.tsx](create-validation.test.tsx)
- [create.test.ts](create.test.ts)
- [field-migrate.test.ts](field-migrate.test.ts)
- [folder-page-react.test.tsx](folder-page-react.test.tsx)
- [list.test.tsx](list.test.tsx)
- [mark-editor-retry.test.tsx](mark-editor-retry.test.tsx)
- [month-regression.test.ts](month-regression.test.ts)
- [searches-tab.test.ts](searches-tab.test.ts)
- [tags-retry-order.test.tsx](tags-retry-order.test.tsx)
- [tags-star.test.tsx](tags-star.test.tsx)
- [tags-tab-archive.test.ts](tags-tab-archive.test.ts)
- [tags-tab-reorder.test.tsx](tags-tab-reorder.test.tsx)
- [viewer-edit-entries.test.tsx](viewer-edit-entries.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/tags`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
