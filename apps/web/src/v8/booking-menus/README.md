> 文書：booking-menus のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 予約設定（V8）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/booking/bookings/detail` → [app/booking/bookings/detail/page.tsx](../../app/booking/bookings/detail/page.tsx)
- `/booking/bookings` → [app/booking/bookings/page.tsx](../../app/booking/bookings/page.tsx)
- `/booking/menus/new` → [app/booking/menus/new/page.tsx](../../app/booking/menus/new/page.tsx)
- `/booking/menus` → [app/booking/menus/page.tsx](../../app/booking/menus/page.tsx)
- `/booking/menus/staff` → [app/booking/menus/staff/page.tsx](../../app/booking/menus/staff/page.tsx)

本体：[assign.tsx](assign.tsx)、[menu-form.tsx](menu-form.tsx)、[settings.tsx](settings.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`MenuFormV8`・`BookingSettingsV8`・`AssignMatrixV8`・`AccountIcon`・`SkeletonRows`・`StateCard`・`useV8TabEdit`・`bookingChannelsApi`
- [public/lib-booking-channels/index.ts](public/lib-booking-channels/index.ts)：`bookingChannelsApi`
- [public/tab-parts/index.ts](public/tab-parts/index.ts)：`AccountIcon`・`SkeletonRows`・`StateCard`・`useV8TabEdit`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api-booking-photos.ts](../../lib/api-booking-photos.ts)
- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/field-errors.ts](../../lib/api/helpers/field-errors.ts)
- [lib/api/helpers/gap1.ts](../../lib/api/helpers/gap1.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [assign-save-retry.test.tsx](assign-save-retry.test.tsx)
- [audience-section.test.ts](audience-section.test.ts)
- [channels-conflict.test.tsx](channels-conflict.test.tsx)
- [channels-summary.test.tsx](channels-summary.test.tsx)
- [channels-tab.test.tsx](channels-tab.test.tsx)
- [holidays.test.tsx](holidays.test.tsx)
- [hours-field-errors.test.tsx](hours-field-errors.test.tsx)
- [lib/preview-slots.test.ts](lib/preview-slots.test.ts)
- [lib/rule-choices.test.ts](lib/rule-choices.test.ts)
- [menu-conflict-reload.test.tsx](menu-conflict-reload.test.tsx)
- [menu-form-followup.test.tsx](menu-form-followup.test.tsx)
- [menu-form-resources.test.tsx](menu-form-resources.test.tsx)
- [menu-version-history-conflict.test.tsx](menu-version-history-conflict.test.tsx)
- [menus-tab-reorder.test.tsx](menus-tab-reorder.test.tsx)
- [photos.test.tsx](photos.test.tsx)
- [rules-partial-save.test.tsx](rules-partial-save.test.tsx)
- [settings-history.test.tsx](settings-history.test.tsx)
- [settings-passes.test.tsx](settings-passes.test.tsx)
- [settings-preview-refresh.test.tsx](settings-preview-refresh.test.tsx)
- [slot-check-race.test.tsx](slot-check-race.test.tsx)
- [staff-calendar.test.tsx](staff-calendar.test.tsx)
- [staff-edit-dialog.test.tsx](staff-edit-dialog.test.tsx)
- [tabs-load-error.test.tsx](tabs-load-error.test.tsx)
- [tabs/loading-timing.test.tsx](tabs/loading-timing.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/booking-menus`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
