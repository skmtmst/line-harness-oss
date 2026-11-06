> 文書：events のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# イベント予約（V8）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/events/bookings` → [app/events/bookings/page.tsx](../../app/events/bookings/page.tsx)
- `/events/change-review` → [app/events/change-review/page.tsx](../../app/events/change-review/page.tsx)
- `/events/edit` → [app/events/edit/page.tsx](../../app/events/edit/page.tsx)
- `/events/new` → [app/events/new/page.tsx](../../app/events/new/page.tsx)
- `/events` → [app/events/page.tsx](../../app/events/page.tsx)
- `/events/preview` → [app/events/preview/page.tsx](../../app/events/preview/page.tsx)

本体：[bookings.tsx](bookings.tsx)、[change-review.tsx](change-review.tsx)、[create.tsx](create.tsx)、[edit.tsx](edit.tsx)、[list.tsx](list.tsx)、[preview.tsx](preview.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`EventBookingsV8`・`EventChangeReviewV8`・`EventsCreateV8`・`EventsListV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [change-review.test.tsx](change-review.test.tsx)
- [create-recovery.test.tsx](create-recovery.test.tsx)
- [create.test.tsx](create.test.tsx)
- [list.test.tsx](list.test.tsx)
- [save-initial-slot.test.ts](save-initial-slot.test.ts)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/events`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
