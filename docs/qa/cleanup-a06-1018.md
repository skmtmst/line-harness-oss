# A06: 外部呼び出しの共通の口

## 範囲と土台

- 指定枝 `codex/kenta-train-cleanup-a06-1018`、指定土台および検査前のfetchは `ff1308a85c7178787fc5d9bbfce4c431a92b07d7`。D01入り。doctorはDOCTOR_LOCAL=1で合格。
- 起点はクリーン。親ECの既存のNodeTerm設定2件とworkspaceファイルは未変更。親・DB・画面・機能側サービスは触らない。
- 調査元は司令塔のWORK-BUNDLES/外部呼び出しTSV2本、lh-extcallの18c27aba52/a45d8b9943。古い共通案の計3回・originだけの遮断・別々の即時retryは採用しない。
- 契約は[段2 §3/§4](../v8-requirements/cleanup-stage2-contract.md#retry)。利用方法は[共通の口](../../apps/worker/src/lib/external-call/README.md)。

## 実装

- SDKは1引数互換を残し、第2引数の単発transportを3通信点へ注入可能にした。再試行は追加せず、HTTP番号/Retry-Afterを保持してエラー本文・statusText・URL・秘密値は落とす。
- LINEの公式対応送信API + retry keyの409だけを受理済みとする。既存の成功経路・元のrequest ID優先を保持。一般の409は成功にしない。
- 既存job/outboxに接続するCAS journalの契約を提供。送信前started→単発要求→結果の保存、snapshot/キー/予算固定、unknown/started/succeededの再実行なし。結果保存失敗もunknown。
- 固定1/5/30分と指数+jitterは同じ予算。API最大4回、より厳しい機能予算を保持、送信Webhookのみ最大8回/24h。Retry-Afterを絶対時刻の下限にし、長い待ちは次回へ返す。sleepしない。
- 店舗/アカウント/接続先/接続IDごとの遮断、open中0要求・半開の同時1回・失敗で再遮断・2回の直列成功で段階復帰。世代で古い成功が新しい遮断を解除することを防ぐ。
- 実行前の現在の権限/停止/同意/上限等のguardを必須とし、共有化を理由に条件を弱めない。

## 残した接続

- 機能サービスの実接続はA01/A03/A07/A08/A10。通信137点とSDK呼出し63行を司令塔の `CLEANUP-1017/A06-HANDOFF.md` へ割り当てた。
- MemoryCircuitStoreは1 isolate内のみ。全Workerで単一probe/遮断を成立させる永続CircuitStoreは未接続。既存の原子的共有台帳を所有者が接続するか、新表の番号承認が必要。表案external_call_circuitsとキー/列は外部handoffへ記載。確認時点の本線最大726/公開37PR最大565から番号案727。SQLは作成していない。
- 永続journalは各機能の既存台帳へ接続する。利用側の不明状態・CAS・lease・providerの照合/保証期限・二重通知の試験も所有者側に残す。共通の口だけで業務全体の回復が完成したとは扱わない。
- 予約リマインダの既存初回込み3回と共通4回の差は司令塔の判断へ。現行の上限を増やしていない。

## 検証

- Node22（ci-localのruntime）・pnpm9.15.4。frozen install成功、lockfile差分なし。
- 最終の影響範囲：共通処理/SDK/受信Webhook/予約リマインダの5ファイル107件成功（`/tmp/a06-target-final.log`）。その後の成功時の古い失敗理由除去も共通/SDK60件で再確認（`/tmp/a06-state-final.log`）。
- Worker型検査・LINE SDK型検査成功（`/tmp/a06-types-final.log` / typecheckの実行出力）。SDK buildもWorker依存buildで成功。
- 故障対照：検査用コピーのみで8種を全検出。429を前倒し/回数超過/open中要求/probe並行/unknown再送/書込切断再送/期限除去/認証失敗再送。正常60件成功→各故障で終了1。`/tmp/a06-mutations.log`、詳細 `/var/folders/6v/dqgxy7ts2b12xlw5764btjc40000gn/T/a06-mutations-9YD0en/summary.json`。元の製品コードの書換えなし。
- 初回の広域検査は修正中の版が混在したため打切り（exit143）、古い409条件等の失敗ログを `/tmp/a06-worker-tests.log` に保持。該当2機能は107件の最終検査で成功。初回ci-localも旧SHAのため中断し、最終製品SHAで新品から開始した。
- 最終製品SHAでWorker全1,096ファイル・12,983件が成功（CI worker-checks-07、実試験400.93秒。枠待ち込み769.9秒）。同じ新品worktreeの型検査も成功。
- 最終製品SHAは `fc419fc40b8e838c4e34390f896eddc843db28bf`。手元CIは `/tmp/a06-ci-local-final.log`、詳細 `~/lh-work/tools/hq/ci-local/logs/20261017-223502-fc419fc40b-15477/`。最終集計は実行後に追記する。
- 反映履歴はCIと同じ検査本文を仮のPR_NUMBER=0000で明示的に実行し成功（`/tmp/a06-release-check.log`）。実在のPRがないことをログに記録。PR未作成・指定の仮番号#0000のため、正式なPRメタデータ照合は未実行。実際のPR番号/題名/本文は司令塔が採番後に通常ゲートで確認する。指定ファイルの見出し・担当・JST日時・#0000は保持。

push・PR・migration作成・DB更新・配備・実送信/実決済・許可追加・検査上限の引上げはない。

### 手元CIの入力不足の回収

- 初回の最終SHAのWorker buildは `vars.VITE_LIFF_ID` 不明で未実行となり、後続のLIFFブラウザ/ヘッダー検査2件が成果物なしで失敗した。製品のビルド失敗ではない。
- GitHub repo variablesを読み取り、VITE_LIFF_ID / VITE_BOT_BASIC_ID / VITE_CALENDAR_CONNECTION_ID / V8_SPEED_ENFORCEMENTはいずれも未設定と確認。設定自体は変更せず、手元の再実行だけ `--var NAME=` で未設定の空値を明示する。
- 同じ製品SHAのworker-buildとv8-screen-guardを再実行し、後で結果を追記する。最初の失敗ログも保持する。

- 空値を明示した再検査はworker-build全工程が成功（本体build14.9秒、LIFF実ブラウザ4.6秒、公開SDK/安全ヘッダー0.9秒）。同じ製品SHA。ログ `/tmp/a06-ci-build-recheck.log`、詳細 `~/lh-work/tools/hq/ci-local/logs/20261017-225911-fc419fc40b-65200/`。
- v8-screen-guardの既存差分判定も成功し、今回は画面/共有型/撮影/lockfile差分がないためrun=false。検査条件や許可は変更していない。再検査の失敗0、実行不能1は正式PR情報不足だけ。

- 最終製品SHAの管理画面はlint・部品選択・旧見た目の復活防止・型検査が成功。全2,308ファイル・13,684件成功、既存skip/todo各1（CI web-checks-10、枠待ち込み364.1秒）。UIコードの変更はない。

### SDKの公開method互換の最終確認

- 後続 `ed9bf082965cd1f892a8dfa3cf49e3e9d53e3cc8` は、受理済み409の対応API判定を保ったまま、methodが小文字postでも従来の成功経路になるよう比較1か所だけ修正。試験に同じ呼び出しを追加した。値/対象/本文/キー/予算/許可先の変更なし。
- 関連3ファイル65件とSDK型検査成功（`/tmp/a06-case-final.log` / `/tmp/a06-sdk-final-type.log`）。この製品SHAでWorker全試験・型・ビルドを再確認する。先行fcの全体検査と混同しない。
