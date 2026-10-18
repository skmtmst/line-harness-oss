# 監視の負荷・費用・検証用実行（B-343、10-16 10:10追加）

2026-10-16 / kenta・Codex。開始`93564566bd`、開始時クリーン・doctor合格。検査前に再取得した開発基点は`eb60ead3e07c4a9bd5baa9bd4b11c7a8d1e6c346`。すでに包含しており、追加のmerge対象はなかった。behaviorfixの旧スコア5経路は`e2ba928a88`の410停止を再確認し、重ねて変更しない。

## 変更と測定

- 691の未適用SQLへ、両監査の検索用UTC列・通常の時刻索引・追加/日時更新時の自動処理を追加。元の日時を変更しない。最初の補完と索引作成は一度だけの別負荷で、DBへは適用していない。platformの元のcreated_at索引は405ですでに存在し、重複追加しない。
- 集計は数日分の候補ではなく、検索用UTC索引から直近15分だけ読む。SQLiteが出力操作の索引を選ぶ問題は、時刻索引をSQLで指定して防ぐ。テスト時計の関数は変更しない。
- **ローカルD1**で2表それぞれ10万行/100万行を投入し、各900行だけが直近15分になる条件を測定。実SQLのEXPLAINは3本とも時刻の範囲検索。実際の`meta.rows_read`は両条件とも1,800＋901＋1,800＝4,501行。件数と生の計画は`SECURITY-MONITOR-COST-1016.json`。
- 監査1件の書込み増分は両表とも3行。DETECTIONへ月8,640回の読み取り・CPU仮定・書込み・初回適用の費用を分けて追記。ローカルNode CPUやD1所要時間をCloudflare Workerの実測CPUに読み替えない。
- 配備先の検証D1には接続・書込みせず、その実測はオーナーの次の確認と明記。10万/100万行の再現用DBの準備も勝手に行わない。

## 検証環境の実行と画面への口

`POST /api/ops/security-alerts/run-once`、入力なし、返却`{ success: true, data: { monitor } }`。管理認証・CSRF・運営の変更権限が必要。閲覧のみ・代理ログイン・通常の店のownerは403。本番/不明な環境は404。監視だけを実行し、配信などの定時処理は呼ばない。5分のleaseを維持し、繰り返しで負荷を増やさない。未適用や失敗は503。

画面側は`apps/web/src/lib/api-security-monitor.ts`の`securityMonitorApi.runOnce()`。OpenAPIへも追加。契約は`SECURITY-MONITOR-CONTRACT.md`と外部の`~/lh-work/design/v8/review/API-CONTRACT-SECURITY-MONITOR.md`へ反映。画面・本番設定・Cron設定は変更しない。

全登録の一覧は1,667経路、管理の共通境界は1,494経路。REVIEW候補378のうち増分1は今回の運営専用口で、実HTTPの拒否試験を付けた。全資源の認可が実証済みという意味へ変えず、S07/S15は未を維持する。

## 試験・故障対照

関連5ファイル46試験、Worker型・Web型、536本のマイグレーション安全検査、bootstrap整合、規模違反0、新しい見た目のソース断定0、差分検査は成功。

| わざと外したもの | 検出 |
| --- | --- |
| 集計SQLの時刻索引指定 | 実際のEXPLAINを読む回帰試験がAssertionError/終了1 |
| 自動処理の従来日本時間の補正 | 時差・追加/変更を確かめる回帰試験が同上 |
| 手動実行の本番拒否 | HTTPの本番/不明環境の拒否試験が同上 |
| 手動実行の運営変更権限 | 通常の担当者・閲覧のみの拒否試験が同上 |
| ローカルD1の両時刻索引（比較実行時は指定も解除） | 10万行の読取り201,804行、計画/読み取り予算のassertで終了1 |

5種類を確認。一時変更は元へ戻し、関連46試験と型を再確認した。構文エラーや未実行を検出へ数えない。`/tmp/lh-security-cost-negative-*.log`と`/tmp/lh-security-monitor-negative.log`に元の結果を保持する。

途中に試験の相対パスの取り違え1件、運営専用確認表の並びの相違1件を見つけて修正した。索引確認の初回は実際に操作名の索引を選んで失敗しており、期待や上限を緩めずSQLの指定を修正した。

21変更ファイルを公式checksum照合済みGitleaks 8.30.1で伏せ字検査し、検出0・終了0。全履歴の再検査ではない。全体検査の最終結果は以下へ追記する。

## 残ること

Googleの専用secret登録・既存平文の移行、S07/S15の全資源/本人の組合せの個別証拠、修正版なしの開発用High、その他点検表のオーナー作業は継続。今回の性能改善で済に変更しない。PR採番前の反映履歴は`pending-kenta-security-monitor-1016.md`、番号を作らず`#未採番`で司令塔へ渡す。

DB適用・配備・本番/検証設定変更・実Slack/LINE送信・push・PR作成・rebase・force・stashはしていない。司令塔は反映履歴の採番、適用前の負荷/使用量と控えの確認、承認済みの反映後に手動口と実際のD1/CPUを確かめる。

## 前回の全体検査と取り込み待ち（以下は解決前の記録）

heavy経由のローカル全体検査（Node26、`/tmp/lh-security-cost-verify/`）では、全workspace型・scripts型・全workspace試験が成功。管理画面13,456成功（既存skip/todo各1）、DB2,272成功、Worker12,003成功。scriptsは1,042成功・1失敗で停止し、後続の全ビルドは未実行。今回の版のci-localも未実行で、以前の結果を今回の成功へ読み替えない。

失敗は`scripts/github-pr-slack-sync-workflow.test.ts`の1件。本線で巡回を1時間ごとへ変えたが、試験が15分ごとを期待している不整合。再取得した本線は引き続き`eb60ead3e0`。既存のPR #1749（`codex/kenta-slack-sync-test-1016`、`2bc4bd0b94c06ecaedb511468caaca882ed7aec9`）が試験と更新履歴の2ファイルだけを直しており、GitHubの必要な検査は成功・PRはOPEN。こちらで同じ修正を作り直さない。

AGENTS.mdのテスト失敗時/同じ箇所の別PR発見時の停止に従い、「既存PRをこの専用枝へ通常mergeする」か「司令塔が本線へ統合した後に本線を取り込む」かを確認中。承認待ちの取り込み・コード変更・コミットは行わない。次は判断された取り込み→影響する検査とscriptsの再実行→全ビルド→内容別コミット→ci-local。push・PR・DB適用・配備はしない。

今回の未コミット変更は21ファイル。用途はこの追加依頼の監視の負荷対策、検証専用API、試験、契約と証拠。開始HEAD`93564566bd`は変更していない。残るパスは以下。

- `apps/web/src/lib/api-security-monitor.ts`
- `apps/worker/src/middleware/route-guard-coverage.test.ts`
- `apps/worker/src/routes/openapi-coverage.test.ts`
- `apps/worker/src/routes/security-alerts.test.ts`
- `apps/worker/src/routes/security-alerts.ts`
- `apps/worker/src/routes/security-monitor-openapi.ts`
- `apps/worker/src/services/security-monitor-counts.ts`
- `apps/worker/scripts/security-monitor-benchmark.ts`
- `apps/worker/src/services/security-monitor-index.test.ts`
- `packages/db/bootstrap.sql`
- `packages/db/migrations/691_security_monitor.sql`
- `docs/security/API-BOUNDARY-RESULTS-1016.tsv`
- `docs/security/API-ROUTE-INVENTORY-1016.tsv`
- `docs/security/API-ROUTE-REVIEW-1016.md`
- `docs/security/DETECTION.md`
- `docs/security/README.md`
- `docs/security/SECURITY-CHECKLIST.md`
- `docs/security/SECURITY-MONITOR-CONTRACT.md`
- `docs/security/SECURITY-MONITOR-COST-1016.json`
- `docs/security/SECURITY-MONITOR-COST-1016.md`
- `docs/release-log/unreleased/pending-kenta-security-monitor-1016.md`

## 10:40の続行指示後：本線の取り込み

司令塔からPR #1749の本線統合と既存21ファイルの引継ぎ・内容別コミットを明示されたため続行。開始時の差分は上記の用途と一致し、doctorは合格、親の作業ツリーはクリーンだった。`git fetch origin`の本線`686467b7d602d624aca626d60d732916c9b6fdd8`を、`6e86d4944d055592246d0aa755285ef4d7461ab6`へ`merge --no-ff`で取り込み、競合なし。追加はSlack巡回の試験と反映履歴だけで、監視の製品コード・依存の変更はない。前回の判断待ちは解消した。

heavy経由でscripts試験を再実行し、114ファイル・1,043試験がすべて成功。前回の失敗1件は本線の修正で解消。追加の製品変更はなく、全workspace型・scripts型・全workspace試験の成功結果と区別して記録する。全workspaceビルドと、このコミット版のci-localは終了を確認して追記する。

費用の公式リンクも再確認し、記載のWorkers・D1の有料枠と超過単価に相違なし。配備先D1は司令塔が691を反映した後の次工程で、今回の4,501行はローカル測定のまま扱う。

製品の内容別コミットは`01a38e0c37`（時刻索引・集計・実測と試験）、`9833f7b3aa`（検証専用の口・HTTP試験・仕様・画面用関数）。前回成功した製品の関連46試験、全workspace型・全workspace試験の後、製品コードを追加変更していない。

今回の初回全ビルドは`NEXT_PUBLIC_API_URL`を命令へ付け忘れ、管理画面の静的生成で終了1。未設定を正しく拒否したもので、合格へ数えない。`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788`を付けた別命令でheavy経由の全ビルドを再実行中。元の失敗ログ`/tmp/lh-security-cost-verify/all-builds-after-1749.log`も残す。設定ファイルや本物の接続先は変更しない。

## 最終結果（10:40の続行指示後）

未コミット21ファイルは`01a38e0c37`（5ファイル、索引・集計・実測）、`9833f7b3aa`（6ファイル、検証専用API）、`a5443b5778`（10ファイル、文書・証拠・仮反映履歴）へ内容別に保存した。全workspaceビルドはAPI URLを明示した再実行で終了0。最初のURL未指定の失敗は残し、成功に数えていない。

### ci-localの全工程

検査HEADは`a5443b57780e68128becbbcd2bb260103feaa61e`、固定した本線は`686467b7d602d624aca626d60d732916c9b6fdd8`。Node22.23.3 / pnpm9.15.4。各重い工程を道具がheavy経由で実行。VITEの公開識別子3種は空、速度は`report`の手元条件で、実際の秘密は取得しない。

| 検査 | 結果 |
| --- | --- |
| DB | 383ファイル・2,272試験成功。bootstrap整合・マイグレーション安全も成功 |
| Worker | 999ファイル・12,003試験、型・ビルド成功 |
| 管理画面 | 2,255ファイル・13,456試験成功、既存skip/todo各1。lint・型・ビルド成功 |
| scripts | 114ファイル・1,042試験成功、既存skip1。型成功（手元Node26では1,043試験成功） |
| 共有・LIFF・SDK・MCP・Docs | 指定された試験・型・ビルドすべて成功 |
| 実ブラウザ | Webhook・権限・通知・二段階認証・操作・設計値が成功 |
| V8 | 3幅の崩れ・故障対照・入力保持・追加ルール・一覧の故障対照・185見出し・表の操作・リッチメニューが成功。速度は11場面各5回を完了し、report条件で超過0 |
| 集約 | 114工程＝成功82・失敗1・省略31（うちPR情報未入力1）。製品検査の失敗0。命令全体の終了値は1 |

失敗1は`required-pr-gate`だけ。実PR未採番のため、`changes`の反映履歴確認が`unsupported`となり、成功/省略だけを許す集約が正しく止まった。PR番号・題名を仮造したり、skip指定や道具の変更で合格にしたりしていない。司令塔が採番後に反映履歴を実番号へ直し、GitHubの必須チェックを確認する。全体CI合格とは報告しない。

生結果：`~/lh-work/tools/hq/ci-local/logs/20261016-084708-a5443b5778-14835/`。初回ビルド・再ビルド・scripts再実行：`/tmp/lh-security-cost-verify/`。旧基点の結果を最新本線の合格へ付け替えない。

### 検査中に追加された本線の取り込み

検査中にPR #1750が統合された。`git fetch origin`後、本線`914270205c0cb610a71d250e96c4bfc029c79c15`を`4c85053d4eafa0749e43cd461f8e0f20f2196bef`へ`merge --no-ff`し、競合なし。差分はデリバリー受信口の試験1本と文書2本のみ。製品コード・型・依存・CI・その他の試験が検査HEADと同一であることを機械で照合した。

この版でheavy経由の関連Worker6ファイル・134試験、全workspace型・scripts型・scripts全1,043試験、全workspaceビルドが終了0。追加された5試験を含む受信口と、監視・時刻索引・実HTTPの権限・OpenAPI・経路一覧を再確認した。更新履歴の生成後、関連Web2ファイル・9試験もheavy経由で成功した。ログは`/tmp/lh-security-cost-verify/after-1750-*.log`。ci-local全工程は上の検査HEADの結果で、#1750取り込み後に全工程をもう1回回したとは書かない。

今回の3コミットを含む範囲と、その後の本線追加範囲をGitleaks8.30.1で伏せ字検査し、検出0・終了0。過去の全履歴検査の件数には足さない。

### 次に司令塔が行うこと

Googleの専用secret登録と旧平文の移行、S07/S15の全資源・全本人組合せの個別証拠、修正版なしの開発用Highと点検表のオーナー作業は残る。691のDB反映・配備・画面接続・配備先D1/CPUの実測と実通知の確認も未実施。今回のローカル性能測定や試験成功で済にしない。

push・PR作成・DB適用・本番/検証設定の変更・配備・実Slack/LINE送信・rebase・force・stashは行っていない。反映履歴は司令塔の採番後に確定する。
