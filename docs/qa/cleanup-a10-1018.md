# 整理の段2 A10：表示集計の整理と残件

対象は `codex/kenta-train-cleanup-a10-1018`、指定土台 `92a53d4836`、検証した製品SHA `e45ff5c0795c8f67b00ac8a9ea336c8bbf00753e`。開始時doctor合格・作業木clean。取得した本線 `e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9` は土台に包含済み。push/PR/DB更新/配備/実送信/決済なし。

**部分完了。要求をまたぐ共有cacheは未実装で、B-365③全体の完了ではない。** 新migrationを作らない指定と、他束のwriterを変更しない所有境界を守り、1回の表示計算内だけを最適化した。全体CIも既存PIN試験と正式PR情報を残して未合格として扱う。

## 変更

- 表示用D1読取を1回の計算内だけ再利用。TTLは読取開始から1秒、128件・JSON換算1MiBまで。SQL全文、bindの型と値、first/all/columnを分離し、返却値を複製する。成功した読取だけ保持し、書込の前後・失敗・終了で失効。旧世代の遅い完了は再登録しない。
- `getDashboardOverview` / `styleSnapshot` / `styleSchedule` / `comparisonData`へ接続。`friend_daily_snapshots`・`hq_store_daily_metrics`は既存のまま使い、日次集計の正本を増やしていない。asOf/computedAt、null、partial/unavailableを保持する。
- 認証・所属・権限・featureは既存の境界で先に検査。送信対象の行・期間・休日・設定・会員、空き/残数/席、支払バッジは今回のcacheへ通さない。送信対象用resultIdは毎回別IDで保存する。setup/A02の店舗flagは変更0。
- dashboard内のLINE送信枠取得を独立したサービスへ移し、A06の単回transportに接続。再試行を増やさず、overview 3.5秒/全体10秒の既存予算を本文読取にも適用。未接続/取得失敗/上限なし/0を区別する。共有journal/遮断の接続完了とは扱わない。
- 概要集計のCTEを同じ意味の派生表へ置換。読取か断定できないCTEをcache側で許可する変更はしていない。変更前後の結果とEXPLAIN QUERY PLAN全8行が一致。
- HTTP path/method/入力/応答・公開関数名・登録順・共有型・画面/Pencil・許可一覧・既存の上限は変更0。既存試験の削除/改名/移動と、外した見張りは0。PLAN-COVERAGE/LONG-FILESのA10割当はいずれも0。

変更した製品ファイルは5→7、1535→1669行、any型0→0。dashboard入口は547→503行。新規試験は3ファイル31件。詳細は外部 `A10-EVIDENCE/metrics.json` と4種類の `DONE-A10.tsv`。

## 同条件の比較

同じfixture/入力でcacheだけを有効/無効にし、応答全体の一致を検査（新規resultIdのみ除外）。D1読取1回の待ちを2msにした単回の参考値であり、本番の速度ではない。

| 対象 | 読取SQL 無効→有効 | 待ちを含む時間の参考値 |
|---|---:|---:|
| 概要 | 18→17 | 11.87→8.94ms |
| 店比較 | 7→6 | 17.26→13.75ms |
| style集計 | 14→14 | SQL削減なし |
| 予定表 | 21→21 | SQL削減なし |

cold/warmは同じ計算内の意味。次のアクセスは必ずcoldで、style系のSQL削減を成果に数えていない。

## 検証

Node22.23.3でCI相当の検査を実行。対象のWorker109件・DB54件、追加Worker13件のUTC/米国西海岸、DB/Workerの型検査が成功。cache故障8種はNode22でもすべて拒否し、復元18件は成功（検査用コピーだけを変更）。

- DB全2327件、リポジトリ用1047件（既存skip1）、共有387件×2TZ、LIFF531件：成功。
- Worker全1108ファイル：13168成功/既存PIN試験1失敗。A10追加13件は成功。
- 管理画面全2304ファイル13676件：成功（既存skip/todo各1）。型・lint・Webhook実ブラウザも成功。
- Worker build/LIFFブラウザ/SDK・安全ヘッダー：成功。V8用の管理画面buildと比較用buildも成功。
- V8基本36場面、状態別201条件は1152/1440/1920で新規/許可/既存の崩れすべて0。故障対照79件、一覧132条件、速度の全測定と予算/参考目標、仮想表の選択/キーボードも成功。公式PASSED台帳は変更0。
- SDK53件、MCP68件・型/build、文書6件、通常管理画面build、後続の権限/アカウント切替/LINE通知/タグ/MFA/セキュリティ/フォームの実ブラウザ：成功。
- ci-local mainは成功55/失敗4/省略53（入力未取得26）。同一SHAのworker-build/V8再実行で不足入力を補完した照合は成功79/失敗2/省略31（正式PR情報未取得1）。残る失敗は既存PIN試験と元の集約ゲート。公式required-pr-gateの合格とは扱わない。

## 全体CIの入力不足と失敗

最初のWorker buildは公開設定の入力が未取得となり省略、後続2工程が成果物なしで失敗。GitHub APIで公開変数4項目が未設定と照合し、設定自体は変えず `--var NAME=` で実際の空値を明示した。同一SHAのworker-buildとv8-screen-guardは全工程成功。元の失敗ログは保持した。仮番号#0000の反映履歴は既存の検査本文で別途成功したが、正式PRゲートの代わりにはしない。

PIN試験は正しい64桁のハッシュに偶然1234を含んで誤拒否した。実装・試験とも土台92a53d4836と同一blob、同一SHAの単独再実行14件は成功。A08所有のため原本を変更せず、独立したPBKDF2計算結果と形式を確認する未適用差分 `A10-to-A08-pin-assertion.patch` を用意。5回失敗/429/解除は保持し、コピーの14件成功と不正hashの故障検出を確認した。生の全試験失敗を合格へ書き換えていない。

## 承認・他束への残件

要求間cacheには、全ての関係する更新と同時に進む世代管理が要る。isolate内のMap、TTLだけ、件数やMAX(updated_at)では別Worker・同秒更新・削除・遅い旧集計を確実に失効できないため、有効にしていない。

案は `display_aggregate_revisions(scope_kind, scope_id, revision, updated_at)`。番号案727は未予約で、本線最大726/公開37PR最大565を照合した時点の案。A06の共有遮断も727案のため司令塔で採番を調整する。SQLファイル作成・DB適用0。A02/A07/A08/A09とA10でwriterを原子的に接続するまで共有cacheはcoldで読む。詳細はD01の契約§6と外部 `A10-HANDOFF.md` を参照する。

## ci-localのログ

- main：`~/lh-work/tools/hq/ci-local/logs/20261018-055024-e45ff5c079-50812/`
- Worker build補完：`~/lh-work/tools/hq/ci-local/logs/20261018-063117-e45ff5c079-82384/`
- V8補完：`~/lh-work/tools/hq/ci-local/logs/20261018-063143-e45ff5c079-83160/`
- 生の結果と補完の対応、同一製品SHAの照合は外部 `A10-EVIDENCE/ci-reconciliation.json`。全112工程の公式結果を書き換えず保持する。

## 記録

外部の `~/lh-work/design/v8/review/CLEANUP-1017/` に `DONE-A10.tsv`（4種類）、`A10-HANDOFF.md`、`A10-EVIDENCE/`、A08への未適用patchを保存。API/画面側の既存関数名は `../API-CONTRACT-A10.md`（同reviewルート）に記録した。

元checkoutの `.nodeterm/project.json`・`.nodeterm/settings.json`・`lh-hq.code-workspace` の既存変更は保持し、今回の変更/コミット0。親ECの変更0。最後のQA追記は製品・試験・ビルド入力を変えない。
