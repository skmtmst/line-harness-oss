> 文書：hq-store-compare のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# hq-store-compare：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/hq/store-comparison` → [app/hq/store-comparison/page.tsx](../../app/hq/store-comparison/page.tsx)

本体：[list.tsx](list.tsx)

## 外に見せる名前（index.ts）

このまとまりには公開index.tsがありません。Nextの入口は本体へ直接接続します。他の機能から内部を読む新しい経路は作らず、公開名が必要になったら機能の所有者が明示します。

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api/helpers/gap3.ts](../../lib/api/helpers/gap3.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- 動きの正本：[機能要件の索引](../../../../../docs/v6-requirements/v6-requirements-master-index.md)、[追加要件](../../../../../docs/v8-requirements/README.md)。
- [list.test.tsx](list.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/hq-store-compare`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
