> 文書：台本・CI・依存の整理と検査記録｜区分：今の説明｜最終確認：2026-10-20（日本時間）

# S02C：台本・CI・依存の整理

指定土台5b1b91c94cから開始し、F01の追加をrebaseせずmergeした。製品検査版は `d76d2f0cf7e3416cafc9155a0dbcb9b42110f853`、取り込み済みF01は `ccec0d14d2dc7b31a04f5c7b6473d2f9c4c9dbe2`。取得した開発本線57c8680a32（PR1777/1778を含む）は祖先。途中の担当外の内容競合はabortして保持し、その後F01経由で解消した。PLAN-COVERAGE/LONG-FILESのS02C割当はともに0件。

## 整理と保持

- 台本42件を用途別へgit mvし、相対import・読込元・CLI入口・CI/package・Codex既存フックの呼出しを同時更新した。従来のdry-run命令名は保持し、役目の分かる入口も用意した。案内は[scriptsの入口](../../scripts/README.md)。
- 未使用の旧V6専用HTML抽出2本のみ削除した。担当台本215ファイル/56,915行→214ファイル/56,787行（README追加1を含む）。F01/S05の台本4件を別計上すると全218ファイル。担当の単体試験88ファイル・ブラウザspec3ファイル・既存検査式1,805箇所を保持した。
- CI16本の権限・条件・needs・工程数を保持。上限・倍率・許可一覧の追加/緩和0、新しい文字固定0、動作/安全検査の削除0。依存の最低安全版4部品を検査へ追加し、わざと古くすると落ちる対照も追加した。
- 未使用のVITE_BOT_BASIC_IDはCI3入力を除去。公開botBasicIdと友だち追加は維持した。F01/Q03が撤去した、初期schemaだけを実行する仮db:migrate/db:migrate:localも復活させていない。
- 使用を確認した部品は保持し、依存の直接宣言130件は同数。TypeScript/tsup/Node型の指定を統一し、lockfileを再生成。@hono/node-server・qs・body-parser・@babel/coreを互換範囲の修正版へ更新。Node22/pnpm9.15.4のfrozen installで再現した。

## 検証

全体ci-localは製品検査版d76d2f0cf7e3416cafc9155a0dbcb9b42110f853で完走。115工程中、成功83・省略31・失敗1。失敗は正式PRタイトルが無く履歴照合を実行できないことによる最後の集約判定だけで、全体CIの完全合格とは扱わない。実PR情報は捏造せず、#0000の採番・正式照合を司令塔へ返す。比較元は57c8680a32。原ログは `/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261019-204853-d76d2f0cf7-43717/summary.md`。

- repository-checks / Test database package：2342 passed (2342)
- repository-checks / Test the self-update engine：161 passed (161)
- repository-checks / Test the setup CLI：69 passed (69)
- repository-checks / pnpm test:scripts：1149 passed | 1 skipped (1150)
- repository-checks / Test shared：399 passed (399)
- repository-checks / pnpm --filter liff test：655 passed (655)
- worker-checks / pnpm --filter worker test：13670 passed (13670)
- web-checks / pnpm --filter web test：13769 passed (13769)
- mcp-checks / Test the SDK：55 passed (55)
- mcp-checks / pnpm --filter @line-harness/mcp-server test：68 passed (68)
- docs-checks / pnpm --filter docs test：6 passed (6)

- doctor合格。Python17試験、Workflow/actionlint、シェル/MJS構文14件、依存安全版の対照11件、文字固定の対照53件、migration/CI接続50件、模擬API指紋2件、文書一覧23件を確認。最終の文書入口/掲載回数/ローカルリンク検査と差分の空白検査も合格。
- 追加のshared/SDK build、プラグインの型・7試験・通常/MCP build、LIFFの型/build、文書サイトの型/build/静的3ページ確認が成功。後のF01追加でこれらのビルド入力が変わらないことも記録した。
- 1152/1440/1920pxのはみ出し36条件、画面状態201条件、一覧行132条件、仮表示93条件は変更後の問題0。壊した見本を検出する対照・狭い画面の入力保持・待ち順/流入元/予約日・仮想表の選択/キーボードも成功。1152/1440pxの撮影を目で確認し、主要情報・操作・メニューは画面内。正式Pencilの90%判定とは区別する。
- 速度は11場面×5回を完測、2,000人/固定一覧/待ち順等の絶対目標超過0。参照予算の超過はdashboard jsBytes=4066452B > 3710688B（+355764B）。既存の報告モードで工程は成功するが、予算内とは扱わない。上限・倍率1.3・回数5・強制変数は変更していない。

検査入力の同一性と最後の記録コミットは外部のfinal-input-equivalence.json / S02C-HANDOFF.mdを参照。製品検査後のQA文書だけの更新を、製品コードの再検査と混同しない。

## 統合担当へ

- 外部/別領域から使う入口5ファイル（overlay-ready、郵便データ関連3本、HQから使うcheck-migrations）は未移動。呼ぶ側と同時にS02Z/司令塔が接続する。
- apps/packages内の未使用入力2箇所、移動前の道を指す文書6箇所、S02Bの_version.tsとrelease Workflowの同時移動はS02Zへ。自分が書いたapps/packagesのソース変更0（依存manifestのみ）。
- 保存済みMCP bundleにはlockfileより古い依存が含まれる。新しい生成物全文・patch・元blob・hashを外部へ保存し、自分のビルド副作用だけ元blobへ復元した。統合側が最新入力から再生成・確認・コミットする。既存bundleまで脆弱性修正済みとは扱わない。
- auditは高1/中5/低4→高1/中0/低2。残るesbuild低2経路は互換性を崩す強制更新を避け、braces高1は公開修正版がないため保留。除外は追加していない。[node-serverの公開情報](https://github.com/advisories/GHSA-92pp-h63x-v22m)と[bracesの公開情報](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)も照合した。
- 初回の失敗・修正・中止・古い版の完走ログは削除せず、最終CIとは分けて保存した。新migration/番号案は不要。DB適用・配備・実送信・決済・外部投稿・push・PRは実行していない。

外部の正本はdesign/v8/review/CLEANUP-1017のS02C-SCRIPTS.tsv（全台本の仕分け）、DONE-S02C.tsv（4区分）、API-CONTRACT-S02C.md、S02C-HANDOFF.md。検査の原ログ・比較・中断理由・生成物は同所S02C-EVIDENCE/へ保存した。
