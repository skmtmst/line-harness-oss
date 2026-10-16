# 2026-10-15 試験直し

作業枝: `codex/kenta-testfix-1015`。開始時・試験前に取得した本線は
`90e6ff1cbaba9b1f1bb44efd7d73392a49b19f8f`（PR #1734）。開始時クリーン、doctor合格。
本線は既に枝へ含まれていた。push・PR・rebase・force・stash・DB更新・配備なし。

## 本線での再現

| 対象 | 変更前の結果 | 対応 |
| --- | --- | --- |
| usage-destinations | 9件成功 | 変更なし |
| update-history | 7件成功 | 変更なし |
| v8-boundary | 3件成功 | 変更なし |
| control-dimensions-contract | 5件成功 | 変更なし |
| grid-name-cell | 2件成功 | 変更なし |
| design-impact（共通Button利用先を含む） | 5件成功 | 一覧の追加不要、変更なし |
| design-debt | 15件成功 | 変更なし |
| hq-templates/attributes | 15件中2件失敗 | DOM試験のstorage準備を修正 |
| line-sdk・受信箱 | distなしで試験の収集失敗 | VitestのSDK参照を実ソースへ |
| line-sdk・オートメーション送信安全性 | distなしで10件中4件失敗 | 同上 |
| マイルの並び順・実SQLite | 9件成功 | 変更なし |
| Web型検査・approvals.tsx | 事前ビルド後に全件成功 | 4件の型エラーは再現せず、変更なし |

新しいworktreeでは最初に `pnpm install --frozen-lockfile` が必要だった。
`pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-harness/update-engine build`
で依存を準備してから比較した。準備前のshared/update-engine解決失敗を製品の失敗へ数えていない。

## 修正の原因と範囲

- Node 26は未利用のlocalStorageの名前もglobalへ持つため、Vitest 3のhappy-dom設定がブラウザのstorageへ置き換えず、`window.localStorage.clear()` がundefinedで失敗した。
  DOM環境に限り、共通setupでhappy-domのメモリ上のStorageをlocal/session別に用意する。
  import時から利用でき、`vi.stubGlobal`の解除後も戻ること、保存・削除・件数・キー・両storageの独立を新しい試験で確認する。
- Workerの実ルートをWeb試験へ読み込むとSDKのdist出力へ依存していた。
  WorkerのVitest設定と同じく、WebのVitestにもSDKのTSソースへの解決を設定する。
  distは一時退避し、変更前後を同条件で比較した後に元へ戻した。
- 製品のTSX/CSS、試験の既存期待値、許可・基準・上限は変更していない。

## マイルの実DB試験を手元で実行する手順

リポジトリのルートで、Node 26.0.0・pnpm 9.15.4を使用した。

```sh
pnpm install --frozen-lockfile
pnpm --filter @line-crm/shared build
pnpm --filter @line-crm/db generate:bootstrap
pnpm --filter worker exec vitest run src/routes/mileage-earning-rules-order.test.ts --maxWorkers=1
```

Nodeのメジャーバージョンを変える際は別ディレクトリで依存を入れる。同じnode_modulesの使い回しではSQLiteのABIが合わない。
必要なのはbetter-sqlite3の実行可能なネイティブ依存と`packages/db/bootstrap.sql`。
試験はメモリ上のSQLiteへ正規のbootstrapを読み込み、認証・ルートも実物を使う。
Cloudflareの資格情報や検証・本番DBへの接続は不要。

## 検証結果

- Node 26: storage関連17件成功。未ビルドSDKの受信箱・オートメーション14件成功。
- CIと同じNode 22.23.3: storage関連と受信箱21件成功。
- Node 22専用の依存を入れた別の一時ディレクトリ（`/tmp/lh-testfix-node22-1015`）で、SDK未ビルドの関連7ファイル49件と実SQLiteのマイル9件が成功。
  Node 26のネイティブSQLiteを使い回した最初のNode 22実行はABI不一致で失敗し、成功に含めていない。
  新しいディレクトリの履歴JSON生成前の収集失敗も成功に含めず、`pnpm --filter web run release-log`後に49件すべてを再実行した。
- Node 26のWeb全試験: 2,236ファイル成功、13,317件成功・既存skip/todo各1（終了0）。
  `zsh ~/lh-work/tools/hq/heavy.sh env NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web run test --maxWorkers=4`
- Web型検査（`pnpm --filter web exec tsc --noEmit --incremental false`）は終了0。
- 変更したTSのeslintはapps/webを作業場所にして終了0・出力なし。
  `pnpm exec eslint src/test-utils/test-environment.ts src/test-utils/browser-storage.test.ts vitest.config.ts`
- 本番形式ビルドは未実施。追加確認としてheavy.shへ並んだが、共有枠待ちのまま未開始で終了した。変更は試験の準備・設定・再発防止試験・文書のみで、製品コードやCSSの変更はない。ビルド成功の報告には含めない。
- 本線・変更前後の生ログ: `/tmp/lh-testfix-1015-evidence/`。

反映履歴は`pending-kenta-testfix-1015.md`へ用意した。司令塔のPR採番後にファイル名と#0000を実番号へ変更する。

## コミット

- `da08d84c60`: DOM試験のstorage準備と再発防止試験。
- `02c415f9ae`: Workerルートを読むWeb試験のSDK解決。
- この記録と未採番の反映履歴を別コミットに保存する。
