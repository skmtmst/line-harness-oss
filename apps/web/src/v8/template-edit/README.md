> 文書：template-edit のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# テンプレートの作る・編集の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/templates/edit` → [app/templates/edit/page.tsx](../../app/templates/edit/page.tsx)

本体：[core.ts](core.ts)、[edit.tsx](edit.tsx)、[message.tsx](message.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`TemplateEditV8`・`ACCOUNT_MISMATCH_MESSAGE`・`TEMPLATE_LOAD_FAILED_MESSAGE`・`TEMPLATE_LOADING_MESSAGE`・`isTemplateDetailData`・`loadTemplateReferences`・`requestTemplateReferences`・`resolveEditorAccountId`・`saveTemplateEdit`・`templateAccountMismatch`・`templateSaveGuard`・`templateUsageEntries`・`validateTemplateSave`・`EMPTY_REFERENCES`・`TemplateReferences`・`TemplateAccountNotice`・`UsageCard`・`TemplateMessageEditor`・`TemplateEditHost`・`TemplateHostContent`・`TemplateRichEditor`・`TemplateAssetEditor`・`TemplateRichVideoEditor`・`TemplateEditFrame`・`CarouselImage`・`uploadCarouselImage`
- [public/asset/index.ts](public/asset/index.ts)：`TemplateAssetEditor`
- [public/carousel-image/index.ts](public/carousel-image/index.ts)：`CarouselImage`
- [public/carousel-image-upload/index.ts](public/carousel-image-upload/index.ts)：`uploadCarouselImage`
- [public/core/index.ts](public/core/index.ts)：`TemplateReferences`・`EMPTY_REFERENCES`・`loadTemplateReferences`
- [public/frame/index.ts](public/frame/index.ts)：`TemplateEditFrame`
- [public/host/index.ts](public/host/index.ts)：`TemplateEditHost`・`TemplateHostContent`
- [public/message/index.ts](public/message/index.ts)：`TemplateMessageEditor`
- [public/rich/index.ts](public/rich/index.ts)：`TemplateRichEditor`
- [public/rich-video/index.ts](public/rich-video/index.ts)：`TemplateRichVideoEditor`
- [rich/index.ts](rich/index.ts)：`RichArea`・`RichShape`・`buildAreas`・`RICH_SHAPES`・`areaPlace`・`AreaActionKind`・`AreaDraft`・`emptyAreaDraft`・`areaDraftConfigured`・`RICH_MESSAGE_TEXT_MAX`・`buildRichPayload`・`default`
- [rich-video/index.ts](rich-video/index.ts)：`default`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/field-errors.ts](../../lib/api/helpers/field-errors.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [edit.test.tsx](edit.test.tsx)
- [rich-field-errors.test.tsx](rich-field-errors.test.tsx)
- [rich-layout-picker.test.tsx](rich-layout-picker.test.tsx)
- [rich-video.test.tsx](rich-video.test.tsx)
- [rich.test.ts](rich.test.ts)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/template-edit`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
