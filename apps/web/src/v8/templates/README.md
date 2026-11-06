> 文書：templates のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# テンプレート一覧の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/templates/carousel` → [app/templates/carousel/page.tsx](../../app/templates/carousel/page.tsx)
- `/templates` → [app/templates/page.tsx](../../app/templates/page.tsx)
- `/templates/questions/new` → [app/templates/questions/new/page.tsx](../../app/templates/questions/new/page.tsx)

本体：[carousel-core.ts](carousel-core.ts)、[carousel.tsx](carousel.tsx)、[list.tsx](list.tsx)、[question-new.tsx](question-new.tsx)

## 外に見せる名前（index.ts）

- [carousel/index.ts](carousel/index.ts)：`inlineActionsText`・`chipName`・`panelsFromContent`・`choiceKindOptions`・`default`
- [index.ts](index.ts)：`CarouselV8`・`panelsFromContent`・`buildCarouselActions`・`buildCarouselContent`・`saveCarousel`・`TemplatesListV8`・`QuestionNewV8`・`messageTypeText`・`TemplateDeleteDialog`・`loadTemplateExamples`
- [public/carousel/index.ts](public/carousel/index.ts)：`CarouselV8`・`panelsFromContent`
- [public/carousel-core/index.ts](public/carousel-core/index.ts)：`saveCarousel`
- [public/delete-dialog/index.ts](public/delete-dialog/index.ts)：`TemplateDeleteDialog`
- [public/examples/index.ts](public/examples/index.ts)：`loadTemplateExamples`
- [public/question-new/index.ts](public/question-new/index.ts)：`QuestionNewV8`
- [public/words/index.ts](public/words/index.ts)：`messageTypeText`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [carousel-buttons.test.tsx](carousel-buttons.test.tsx)
- [carousel-field-errors.test.tsx](carousel-field-errors.test.tsx)
- [carousel-upload.test.tsx](carousel-upload.test.tsx)
- [carousel.test.ts](carousel.test.ts)
- [delete-dialog.test.tsx](delete-dialog.test.tsx)
- [list.test.tsx](list.test.tsx)
- [panel-detail.test.tsx](panel-detail.test.tsx)
- [question-new-react.test.tsx](question-new-react.test.tsx)
- [question-new.test.ts](question-new.test.ts)
- [staff-asset-list-failure.test.tsx](staff-asset-list-failure.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/templates`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
