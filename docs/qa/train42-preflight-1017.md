# 列車42：PR #1765 の取り込み前検査

記録：2026-10-17 17:31 JST。検査・修正のHEAD：`ffbaf5e6c24f9083e2dc2f671567037534d4fc69`。本線：`05b243b13d7c30008dc92331f8847ac6233dc91d`。

固定したgap3 `a57806183e`、behaviorfix `889b698eab`、secfix `3149f517cb` と本線を `merge --no-ff` で統合した。期待値・閾値・検査対象・許可は緩めていない。

## 検査方法

- Required PR gate の workflow 定義を ci-local で実行。Node 22.23.3、pnpm 9.15.4、macOS、frozen-lockfile。Actionsのcheckout/setup/cacheは手元の準備で代行。重い工程は共用heavy.shを経由した。
- BASEは上記本線SHA、HEAD_REFは `codex/kenta-train-42-1017`、PR番号は1765。入口で所有パス・反映履歴・差分・workflow構文を検査した。GitHub側で未設定の4変数だけを空で指定した。
- 全工程の初回でWorker試験5件が失敗したため補修。影響するRepository・Worker検査/ビルド・Docs・入口を最新コミットで再実行。Web・LIFF・packages・scripts・workflowのGitオブジェクト一致を確認して、変わっていないジョブの結果を併用した。
- 初回のraw集約は旧Worker失敗を保持する。最終集約は実際に成功した依存ジョブの結果を使い、workflowと同じシェルで別途実行した。単一実行が全件成功したという記録には置き換えていない。

## ジョブ別結果

時間は枠待ちを含む工程の合計。

| ジョブ | 合否 | 実行 | 秒 |
| --- | --- | --- | ---: |
| changes | 合格 | 20261017-143410-ffbaf5e6c2-28026 | 2.73 |
| repository-checks | 合格 | 20261017-143410-ffbaf5e6c2-28026 | 628.96 |
| worker-checks | 合格 | 20261017-143410-ffbaf5e6c2-28026 | 736.09 |
| worker-build | 合格 | 20261017-143410-ffbaf5e6c2-28026 | 70.11 |
| web-checks | 合格 | 20261017-135804-aa3b559775-88376 | 740.28 |
| mcp-checks | 合格 | 20261017-135804-aa3b559775-88376 | 387.49 |
| docs-checks | 合格 | 20261017-143410-ffbaf5e6c2-28026 | 53.61 |
| web-build | 合格 | 20261017-135804-aa3b559775-88376 | 227.96 |
| v8-screen-guard | 合格 | 20261017-135804-aa3b559775-88376 | 1688.86 |
| required-pr-gate | 合格 | 同一workflowシェルで最終集約 | 0.00 |

## 命令と各工程の時間

全命令は [初回commands](train42-preflight-1017/full-commands.json) と [補修後commands](train42-preflight-1017/affected-commands.json) に実行時のまま保存した。結果・対象環境は同じ場所のresults/manifest、定義は [workflow](train42-preflight-1017/workflow.yml)。下表の番号はJSONの命令キーに対応する。

| ジョブ・工程 | 命令/工程名 | 合否 | 秒 |
| --- | --- | --- | ---: |
| changes-02.sh | Protect command-center owned documents | 成功 | 0.02 |
| changes-03.sh | Select the required test scope | 成功 | 0.09 |
| changes-04.sh | Reject whitespace errors in the PR diff | 成功 | 0.15 |
| changes-05.sh | Require a release-log entry | 成功 | 0.22 |
| changes-06.sh | Check shell syntax | 成功 | 0.06 |
| changes-07.sh | Check workflow YAML and run-step shell syntax | 成功 | 2.19 |
| repository-checks-04.sh | pnpm install --frozen-lockfile | 成功 | 9.68 |
| repository-checks-05.sh | Guard shared pattern ownership (B-172) | 成功 | 17.30 |
| repository-checks-06.sh | Guard newly added source visual contracts (B-273) | 成功 | 7.94 |
| repository-checks-07.sh | Build shared packages | 成功 | 7.72 |
| repository-checks-08.sh | pnpm --filter @line-crm/db check:bootstrap | 成功 | 5.00 |
| repository-checks-09.sh | Migration safety check | 成功 | 1.26 |
| repository-checks-10.sh | Test database package | 成功 | 181.67 |
| repository-checks-11.sh | Test the self-update engine | 成功 | 6.88 |
| repository-checks-12.sh | Test the setup CLI | 成功 | 2.23 |
| repository-checks-13.sh | pnpm test:scripts | 成功 | 10.12 |
| repository-checks-14.sh | Typecheck repository scripts | 成功 | 2.38 |
| repository-checks-15.sh | Test shared | 成功 | 363.80 |
| repository-checks-16.sh | pnpm --filter liff typecheck | 成功 | 3.66 |
| repository-checks-17.sh | pnpm --filter liff test | 成功 | 9.32 |
| worker-checks-04.sh | pnpm install --frozen-lockfile | 成功 | 9.95 |
| worker-checks-05.sh | Build Worker dependencies | 成功 | 308.35 |
| worker-checks-06.sh | pnpm --filter worker typecheck | 成功 | 25.39 |
| worker-checks-07.sh | pnpm --filter worker test | 成功 | 392.40 |
| worker-build-04.sh | pnpm install --frozen-lockfile | 成功 | 10.14 |
| worker-build-05.sh | Build Worker dependencies | 成功 | 7.70 |
| worker-build-06.sh | Build Worker | 成功 | 14.27 |
| worker-build-07.sh | Install browser for deployed LIFF entry guard | 成功 | 32.68 |
| worker-build-08.sh | Guard customer waitlist entry, theme and short actions (B-247 E3) | 成功 | 4.42 |
| worker-build-09.sh | Verify LIFF security headers and public SDK compatibility | 成功 | 0.90 |
| web-checks-04.sh | pnpm install --frozen-lockfile | 成功 | 10.02 |
| web-checks-05.sh | Build Admin dependencies | 成功 | 2.38 |
| web-checks-06.sh | pnpm --filter web exec next lint --report-unused-disable-directives-severity error | 成功 | 26.60 |
| web-checks-07.sh | node apps/web/scripts/verify-entity-pickers.mjs | 成功 | 1.90 |
| web-checks-08.sh | Reject restored legacy admin appearance | 成功 | 1.44 |
| web-checks-09.sh | pnpm --filter web typecheck | 成功 | 30.86 |
| web-checks-10.sh | pnpm --filter web test | 成功 | 605.99 |
| web-checks-11.sh | Install Chromium for the webhook runtime contract | 成功 | 21.52 |
| web-checks-12.sh | Webhook screen runtime contract on a real browser (#704, | 成功 | 39.57 |
| mcp-checks-04.sh | pnpm install --frozen-lockfile | 成功 | 18.24 |
| mcp-checks-05.sh | Build MCP dependencies | 成功 | 41.90 |
| mcp-checks-06.sh | Test the SDK | 成功 | 1.83 |
| mcp-checks-07.sh | pnpm --filter @line-harness/mcp-server typecheck | 成功 | 2.28 |
| mcp-checks-08.sh | pnpm --filter @line-harness/mcp-server test | 成功 | 322.49 |
| mcp-checks-09.sh | pnpm --filter @line-harness/mcp-server build | 成功 | 0.75 |
| docs-checks-04.sh | pnpm install --frozen-lockfile | 成功 | 11.88 |
| docs-checks-05.sh | pnpm --filter docs test | 成功 | 41.73 |
| web-build-05.sh | pnpm install --frozen-lockfile | 成功 | 9.55 |
| web-build-06.sh | Build Admin dependencies | 成功 | 42.44 |
| web-build-07.sh | pnpm --filter web build | 成功 | 79.78 |
| web-build-08.sh | Install Chromium for the browser behavior tests | 成功 | 27.14 |
| web-build-09.sh | Verify media permissions on the built admin | 成功 | 13.02 |
| web-build-10.sh | Verify EC import list account-switch behavior on the built admin | 成功 | 9.18 |
| web-build-12.sh | LINE notifications real-browser behavior (#678) | 成功 | 8.26 |
| web-build-13.sh | Verify archived tag edit behavior on the built admin | 成功 | 6.00 |
| web-build-14.sh | MFA auth input and button behavior at three widths | 成功 | 8.72 |
| web-build-15.sh | Verify admin security headers and auth interactions | 成功 | 1.05 |
| web-build-17.sh | pnpm --filter web verify:design | 成功 | 2.01 |
| web-build-18.sh | Install Chromium for browser checks | 成功 | 0.44 |
| web-build-19.sh | Admin browser behavior checks | 成功 | 20.37 |
| v8-screen-guard-02.sh | Decide whether to run the screen guard | 成功 | 0.06 |
| v8-screen-guard-05.sh | pnpm install --frozen-lockfile | 成功 | 9.69 |
| v8-screen-guard-06.sh | Build the PR admin against the visual-qa mock API | 成功 | 86.82 |
| v8-screen-guard-07.sh | Build the base admin against the same mock API | 成功 | 100.33 |
| v8-screen-guard-08.sh | Install Chromium for the V8 screen guard | 成功 | 22.01 |
| v8-screen-guard-09.sh | Start the mock API and serve the built admin | 成功 | 1.12 |
| v8-screen-guard-10.sh | No V8 layout breaks at 1152, 1440 and 1920 | 成功 | 95.64 |
| v8-screen-guard-11.sh | Broken fixtures must fail the V8 layout guard | 成功 | 71.94 |
| v8-screen-guard-12.sh | Narrow preview opens once and preserves form input | 成功 | 65.62 |
| v8-screen-guard-13.sh | Train 17 waitlist failure and inflow mouse regressions | 成功 | 12.97 |
| v8-screen-guard-14.sh | Booking preview date agrees through settings and preview tabs | 成功 | 8.67 |
| v8-screen-guard-15.sh | No new V8 layout or owner-rule defects (B-191 through B-218) | 成功 | 329.66 |
| v8-screen-guard-16.sh | List row rules (B-190/193/194/195/198, with negative controls) | 成功 | 592.40 |
| v8-screen-guard-17.sh | All admin page titles are 22px / 700 / 32px at 1440 | 成功 | 169.27 |
| v8-screen-guard-18.sh | Speed measurement and reference policy controls | 成功 | 1.98 |
| v8-screen-guard-19.sh | Common V8 speed checks (11 scenes, five medians) | 成功 | 103.66 |
| v8-screen-guard-20.sh | Train 17 absolute targets | 成功 | 0.25 |
| v8-screen-guard-21.sh | 2000 friends meet absolute speed targets | 成功 | 0.09 |
| v8-screen-guard-22.sh | PERF-01 fixed list speed targets | 成功 | 0.20 |
| v8-screen-guard-23.sh | Report speed reference results (including incomplete measurements) | 成功 | 0.09 |
| v8-screen-guard-24.sh | Virtual table selection, keyboard and layout | 成功 | 13.95 |
| v8-screen-guard-25.sh | Rich-menu label font sizes at three widths (m22a) | 成功 | 2.43 |
| v8-screen-guard-26.sh | Upload V8 screen guard results | 成功 | 0.01 |
| v8-screen-guard-27.sh | Upload separate speed diagnosis traces | 飛ばした | 0.00 |

速度計測は11場面・各5回で完了し、予算と参考目標（PERF-01を含む）に合格。[計測値](train42-preflight-1017/speed.json) と工程19〜23のログを保存した。診断用traceは異常がなく生成されなかったため、工程27の任意アップロードだけは定義どおりスキップ。

## 競合と不合格への対応

- 回数券・月謝はpassesへ統合しticketsからの移行、商品の一覧、作成、Dの案内、paymentsのタブを保持。移動済みの窓・部品には移動先へ双方の操作を残した。
- LIFFの同意・追加メニュー・一部返金・同じ入力の返金再試行キー、通知設定型3項目を保持。
- 自動mergeで重なった監視一覧72行だけを除去。同じ566件の集合を維持。broadcastsの純粋JSON補助関数を本体を変えず別ファイルへ移し、固定の行数上限を満たした。
- 設定型の同一importとルーター調査の古い二重処理を除去。内部のスコープ識別と従来の表示名を両立し、既存53試験を通した。
- 新しい端末の保存処理に対し、ログイン試験3件の空DBを種データ入りD1へ修正。既存101件の期待を変えず全件合格。
- 保存期限の定期処理を有効/保留/直前再確認を持つcoreのgatedジョブとして登録（免除の追加なし）。公開APIの仕様一覧に不足19経路の実際の認証・制限を追記。関連14試験合格。
- 本線#1761の取り込み後、Googleプロフィールなど関連6ファイル60試験も合格。全パッケージpnpm typecheck合格後、追加補修したWorkerの型を再検査して合格。

## 一括型検査の補足

Node22で準備した作業コピーの実ファイルをaa3b559775と照合し、`pnpm typecheck` を実行して合格（枠待ちを含め335.01秒）。[全ログ](train42-preflight-1017/workspace-typecheck.txt)。その後に変えたWorkerの型は、補修後worker-checksで再び全件合格した。他パッケージの入力はsource-equivalence.jsonのとおり一致する。

## SQL・反映履歴・終了確認

- 追加SQL37本は固定元と同一。686〜691・698〜726は各番号1本で今回の衝突0。既存の古い重複番号とは区別した。マイグレーションの作成・改番・内容変更・実DB適用はなし。
- この列車で追加する反映履歴10ファイルを1765-kenta-*へ整理し番号を#1765へ統一。同じ行だけを重複除去し、本線に既存の履歴（#1761/#1764を含む）は維持。unreleased.mdには追加していない。
- 最後のfetchで本線は `05b243b13d7c30008dc92331f8847ac6233dc91d`。このSHAを含み、遅れなし。
- 補修・QA文書のコミット直前に `git diff --cached --check` は合格。補修後・QA文書コミット後の作業ツリーもクリーン。文書を含めた入口・Docsの再検査は下記。
- ブラウザの見張り合格はPencilとの全画面照合の承認を代替しない。push・PR操作・DB更新・コード配備・実送信/決済は実施していない。

## 文書を含めた最終確認

- 2026-10-17 17:38 JST、QA文書コミット `f545154e65c7cac71bfbf754682f44e57c1929b3` の入口7工程・Docs5工程は全合格。時間は入口3.37秒、Docs292.41秒（枠待ちを含む）。
- [命令](train42-preflight-1017/final-docs-commands.json)・[工程結果](train42-preflight-1017/final-docs-results.json)・[対象](train42-preflight-1017/final-docs-manifest.json)・[最終照合](train42-preflight-1017/final-verification.json)を保存。成功した依存結果による同一集約シェルも再び合格。
- 最後に本線を再取得し `05b243b13d7c30008dc92331f8847ac6233dc91d` で変更なしを確認。全検査後に追加したものは進捗・QAの記録のみで、実装と検査定義は同一。
