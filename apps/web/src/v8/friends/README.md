> 文書：friends のコード案内｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# 友だち（V8）の動き：コードの入口

現役の読み込み先を探す案内です。URL・保存・権限・失敗時の条件は下の動きの説明と要件を読み、ここへ複製しません。

## URLから本体へ

- `/accounts` → [app/accounts/page.tsx](../../app/accounts/page.tsx)
- `/duplicates` → [app/duplicates/page.tsx](../../app/duplicates/page.tsx)
- `/friends/identity-candidates` → [app/friends/identity-candidates/page.tsx](../../app/friends/identity-candidates/page.tsx)
- `/friends/migrations` → [app/friends/migrations/page.tsx](../../app/friends/migrations/page.tsx)
- `/friends` → [app/friends/page.tsx](../../app/friends/page.tsx)
- `/users` → [app/users/page.tsx](../../app/users/page.tsx)

本体：[compare/compare.tsx](compare/compare.tsx)、[host.tsx](host.tsx)、[migrations/page.tsx](migrations/page.tsx)

## 外に見せる名前（index.ts）

- [friends-tabs/index.ts](friends-tabs/index.ts)：`FRIENDS_MERGED_TABS`
- [index.ts](index.ts)：`CompareV8`・`FriendMigrationsV8`・`FriendsHostV8`・`splitCsvRecords`・`CANDIDATE_PAGE_SIZE`・`formatRelative`・`useDuplicatesData`
- [public/duplicates-use-duplicates-data/index.ts](public/duplicates-use-duplicates-data/index.ts)：`CANDIDATE_PAGE_SIZE`・`formatRelative`・`useDuplicatesData`
- [public/migrations-friend-csv/index.ts](public/migrations-friend-csv/index.ts)：`splitCsvRecords`

機能の内部は宣言元を直接読み、外部は明示された公開入口を使います。Nextのpage・layoutとWorkerのroute登録は直接接続します。決まりは [コードの構成と名前](../../../../../docs/code-structure.md)。

## API・保存の実装へ

- [lib/api.ts](../../lib/api.ts)

HTTP契約は [API文書の一覧](../../../../../docs/README.md#api)、失敗の形式は [エラーの共通契約](../../../../../docs/error-codes.md)。公開名や応答を改名しません。

## 動きと試験

- [BEHAVIOR.md](BEHAVIOR.md)
- [compare/detail-failure-regression.test.tsx](compare/detail-failure-regression.test.tsx)
- [duplicates/list.test.tsx](duplicates/list.test.tsx)
- [duplicates/use-duplicates-data.test.tsx](duplicates/use-duplicates-data.test.tsx)
- [friends-words.test.ts](friends-words.test.ts)
- [list/account-snapshot-regression.test.tsx](list/account-snapshot-regression.test.tsx)
- [list/field-search.test.tsx](list/field-search.test.tsx)
- [list/support-status.test.tsx](list/support-status.test.tsx)
- [list/words-speed.test.ts](list/words-speed.test.ts)
- [migrations/csv-download.test.tsx](migrations/csv-download.test.tsx)
- [migrations/csv.test.tsx](migrations/csv.test.tsx)
- [migrations/use-friend-migrations.test.tsx](migrations/use-friend-migrations.test.tsx)

実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/friends`。関連する入口の試験も実行してください。保存・入力保持・権限・別店舗・失敗からの回復を守り、文書の整合だけを動作の合格に数えません。
