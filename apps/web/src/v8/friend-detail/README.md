> 文書：friend-detail のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 友だち詳細の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/friends/detail` → [app/friends/detail/page.tsx](../../app/friends/detail/page.tsx)

本体：[detail.tsx](detail.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`FriendDetailV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)
- [lib/api/helpers/booking-entitlements.ts](../../lib/api/helpers/booking-entitlements.ts)
- [lib/api/helpers/booking-payment-admin.ts](../../lib/api/helpers/booking-payment-admin.ts)
- [lib/api/helpers/friend-delivery-consents.ts](../../lib/api/helpers/friend-delivery-consents.ts)
- [lib/api/helpers/gap3.ts](../../lib/api/helpers/gap3.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [delivery-consent.test.tsx](delivery-consent.test.tsx)
- [detail.test.tsx](detail.test.tsx)
- [dialogs.test.tsx](dialogs.test.tsx)
- [forms-tab-answers.test.tsx](forms-tab-answers.test.tsx)
- [info-tab.test.tsx](info-tab.test.tsx)
- [use-friend-detail.test.tsx](use-friend-detail.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/friend-detail`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
