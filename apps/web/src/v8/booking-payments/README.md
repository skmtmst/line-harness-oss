> 文書：booking-payments のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# booking-payments：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/booking/bookings/detail` → [app/booking/bookings/detail/page.tsx](../../app/booking/bookings/detail/page.tsx)
- `/booking/bookings` → [app/booking/bookings/page.tsx](../../app/booking/bookings/page.tsx)

本体：[assignment.tsx](assignment.tsx)、[booking-charges.tsx](booking-charges.tsx)、[booking-group.tsx](booking-group.tsx)、[cancellation.tsx](cancellation.tsx)、[events.tsx](events.tsx)、[menu-deposit.tsx](menu-deposit.tsx)、[menu-payment.tsx](menu-payment.tsx)、[payments-side.tsx](payments-side.tsx)、[payments-tab.tsx](payments-tab.tsx)、[records.tsx](records.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`BookingGroupSection`・`useMenuPayment`・`MenuPaymentCard`・`PaymentConflictError`・`PaymentSideCard`・`MenuPaymentFields`・`BookingMenuPaymentCard`・`useMenuDeposit`・`AssignmentConflict`・`AssignmentRowDialog`・`AssignmentSection`・`PRIORITY`・`useAssignment`・`BookingChargesSection`
- [payments-side/index.ts](payments-side/index.ts)：`default`
- [payments-tab/index.ts](payments-tab/index.ts)：`PaymentsTabV8`
- [public/assignment/index.ts](public/assignment/index.ts)：`AssignmentConflict`・`AssignmentRowDialog`・`AssignmentSection`・`PRIORITY`・`useAssignment`
- [public/booking-charges/index.ts](public/booking-charges/index.ts)：`BookingChargesSection`
- [public/booking-group/index.ts](public/booking-group/index.ts)：`BookingGroupSection`
- [public/menu-deposit/index.ts](public/menu-deposit/index.ts)：`BookingMenuPaymentCard`・`useMenuDeposit`
- [public/menu-payment/index.ts](public/menu-payment/index.ts)：`MenuPaymentCard`・`MenuPaymentFields`・`PaymentConflictError`・`PaymentSideCard`・`useMenuPayment`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/booking-advanced.ts](../../lib/api/helpers/booking-advanced.ts)
- [lib/api/helpers/booking-assignment.ts](../../lib/api/helpers/booking-assignment.ts)
- [lib/api/helpers/booking-payment-admin.ts](../../lib/api/helpers/booking-payment-admin.ts)
- [lib/api/helpers/gap1.ts](../../lib/api/helpers/gap1.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- 動きの正本：[機能要件の索引](../../../../../docs/v6-requirements/v6-requirements-master-index.md)、[追加要件](../../../../../docs/v8-requirements/README.md)。
- [booking-charges.test.tsx](booking-charges.test.tsx)
- [booking-group.test.tsx](booking-group.test.tsx)
- [connection-card.test.tsx](connection-card.test.tsx)
- [menu-deposit-choice.test.tsx](menu-deposit-choice.test.tsx)
- [menu-payment.test.tsx](menu-payment.test.tsx)
- [records-refund.test.tsx](records-refund.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/booking-payments`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
