> 文書：login のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 運営 ログイン 2段目の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/login/two-factor` → [app/login/two-factor/page.tsx](../../app/login/two-factor/page.tsx)
- `/login/two-factor/setup` → [app/login/two-factor/setup/page.tsx](../../app/login/two-factor/setup/page.tsx)

本体：[two-factor-admin.tsx](two-factor-admin.tsx)、[two-factor-ops.tsx](two-factor-ops.tsx)、[two-factor-setup.tsx](two-factor-setup.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`AdminTwoFactorV8`・`OpsTwoFactorV8`・`RecoveryCodePanel`
- [public/recovery-codes/index.ts](public/recovery-codes/index.ts)：`RecoveryCodePanel`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [auth.spec.mjs](auth.spec.mjs)
- [recovery-codes.test.tsx](recovery-codes.test.tsx)
- [two-factor-ops.test.tsx](two-factor-ops.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/login`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
