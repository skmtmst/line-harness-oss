> 文書：inflow-links のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 流入と計測の一覧（V8）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/inflow-links/detail` → [app/inflow-links/detail/page.tsx](../../app/inflow-links/detail/page.tsx)
- `/inflow-links/edit` → [app/inflow-links/edit/page.tsx](../../app/inflow-links/edit/page.tsx)
- `/inflow-links/new` → [app/inflow-links/new/page.tsx](../../app/inflow-links/new/page.tsx)
- `/inflow-links` → [app/inflow-links/page.tsx](../../app/inflow-links/page.tsx)

本体：[ad-connections.tsx](ad-connections.tsx)、[ad-history.tsx](ad-history.tsx)、[ads.tsx](ads.tsx)、[detail.tsx](detail.tsx)、[list.tsx](list.tsx)、[new/create.tsx](new/create.tsx)、[site-script.tsx](site-script.tsx)

## 外に見せる名前（index.ts）

- [index.ts](index.ts)：`InflowDetailV8`・`InflowListV8`・`InflowCreateV8`・`AdConnectionsV8`・`AdHistoryV8`・`SiteScriptV8`・`AdsV8`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [new/BEHAVIOR.md](new/BEHAVIOR.md)
- [account-switch-race.test.tsx](account-switch-race.test.tsx)
- [ad-connection-dialog.test.tsx](ad-connection-dialog.test.tsx)
- [ad-pages.test.tsx](ad-pages.test.tsx)
- [detail-friends.test.tsx](detail-friends.test.tsx)
- [edit-route-conflict.test.tsx](edit-route-conflict.test.tsx)
- [genre-dialog.test.tsx](genre-dialog.test.tsx)
- [list.test.tsx](list.test.tsx)
- [new/create.test.tsx](new/create.test.tsx)
- [qr-route-switch.test.tsx](qr-route-switch.test.tsx)
- [rows.test.ts](rows.test.ts)
- [site-input-errors.test.tsx](site-input-errors.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/inflow-links`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
