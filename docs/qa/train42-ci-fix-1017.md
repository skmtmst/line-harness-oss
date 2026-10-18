# PR #1765：GitHub CIの予約入口・入口一覧の修正

開始HEAD：`1ab48d92bb`。作業場所：`lh-gapuitrain`、枝：`codex/kenta-train-42-1017`。
開始時はクリーン、`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は合格。

## 本線の取り込み

`git fetch origin` で #1766 の本線入りを確認し、`78257437ac23820b76b3f31d0ceabe296a20557e` を `git merge --no-ff origin/codex/development` で取り込んだ。
競合解消の補助処理は初回、区切りの照合範囲が広過ぎてファイル末尾まで削った。差分検査で検出し、Gitのmerge元データから18ファイルを復元して区切り単位で解き直した。検査前に削り過ぎを解消し、DBの組み立て・最終差分・関連試験で保持を確認した。

18ファイルの競合は、列車の追加機能と本線の修正を保持して解消。権限の比較表・OpenAPIの追加一覧は双方を保持。入力エラー後の移動は本線の描画後の処理を採用し、既知端末を保存する試験のDB準備は一つにまとめた。
初回のDB定義の確認は、既定のNode 26とNode 22用のネイティブ依存が一致せず実行できなかった。CIと同じNode 22で再実行して成功した。

個人情報の保存期限のジョブ情報は本線の共通ファイルへ移し、列車で追加した有効化・保留・直前の設定変更の3つの見張りを移植した。マイグレーションは追加・変更せず、組み立てたDB定義のチェックも成功。

## 失敗の再現と修正

- GitHub の失敗run：`39020929762`。Adminは予約入口から409の表示を待つ1件、WorkerはS07/S15の一覧検査が7,154msで既定5,000msを超えた1件だった。
- 本線の取り込み後、`NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev pnpm --filter web test` で同じ予約入口の失敗を再現。2,307ファイル中1ファイル、13,675件合格・1件失敗（既存skip/todo各1）、248.33秒。確認画面は費用見積もりを取得できず、予約を送らずに停止していた。
- 入口試験にも実在する費用見積もりの正常応答と保有券の空応答を用意し、読込完了で予約ボタンが有効になるのを待つ。既存の409表示・入力保持・再試行の本文と冪等キーの一致・本人認証の期待値は変えていない。見積もり失敗を無視する製品側の変更は行っていない。
- 一覧の検査器では、継承する認証処理をルーター別に整理し、同じ引数の呼出し関係を同じ解析内で再利用する。全ファイル・全経路を引き続き解析する。新しい試験で、再帰する共通処理、複数のHTTPメソッド、別の道への誤った波及、処理の削除後の再解析を確認した。
- 変更前後の全1,933行（パス・メソッド・行番号・呼出し・権限の根拠を含む）はJSONのバイト列まで一致。SHA-256はともに `bfd02dd273a913879ef4c1e8abcc9994223ef7c1919a3758facc11270c76c9a0`。手元の単独測定は0.639秒→0.597秒。Linuxの速度を保証する数字ではない。検査対象・既存の期待値・許可・制限時間は変えていない。
- 追加した検査器の試験は初回、実際には呼び出していない外部関数を見本に置いたため1件失敗。見本で関数を呼び出すよう直し、期待値を保って再検査した。

## 検査条件

Node 22.23.3・pnpm 9.15.4、macOS。`.github/workflows/required-pr-gate.yml` からWorkerとAdminの各`run`を順番にそのまま抽出し、`bash -e`で実行。最終ジョブは`CI=true`・`TZ=UTC`、AdminのAPI URLもworkflowの指定と同じ。重い処理は共用`heavy.sh`を通して直列に実行し、Vitest最大4並列を維持。
Actionsのcheckout/setup/cache/uploadは手元の作業ツリーと準備で代行し、LinuxのOS差は再現していない。ブラウザ試験のサーバー準備はworkflowの命令と設定ファイルに従う。

予約入口・カーソル移動の関連2ファイル7件、Workerの関連8ファイル227件は合格。ジョブごとの命令・開始時刻・秒数・終了値は [results.json](train42-ci-fix-1017/results.json)。

## 最終結果

| ジョブ | 結果 | 試験 | 合計秒 |
| --- | --- | --- | ---: |
| Worker | 全工程合格 | 1,093ファイル・12,910件合格 | 426.66 |
| Admin | 全工程合格 | 2,307ファイル・13,676件合格、既存skip/todo各1、実ブラウザ16件合格 | 350.80 |

| ジョブ・工程 | 命令または工程名 | 結果 | 秒 |
| --- | --- | --- | ---: |
| worker-checks 4 | pnpm install --frozen-lockfile | 合格 | 3.77 |
| worker-checks 5 | Build Worker dependencies | 合格 | 7.24 |
| worker-checks 6 | pnpm --filter worker typecheck | 合格 | 22.86 |
| worker-checks 7 | pnpm --filter worker test | 合格 | 392.79 |
| web-checks 4 | pnpm install --frozen-lockfile | 合格 | 3.89 |
| web-checks 5 | Build Admin dependencies | 合格 | 2.02 |
| web-checks 6 | pnpm --filter web exec next lint --report-unused-disable-directives-severity error | 合格 | 25.07 |
| web-checks 7 | node apps/web/scripts/verify-entity-pickers.mjs | 合格 | 2.09 |
| web-checks 8 | Reject restored legacy admin appearance | 合格 | 1.59 |
| web-checks 9 | pnpm --filter web typecheck | 合格 | 31.88 |
| web-checks 10 | pnpm --filter web test | 合格 | 246.76 |
| web-checks 11 | Install Chromium for the webhook runtime contract | 合格 | 0.85 |
| web-checks 12 | Webhook screen runtime contract on a real browser (#704, | 合格 | 36.65 |

最終fetch：2026-10-17 19:28 JST、本線は `78257437ac23820b76b3f31d0ceabe296a20557e` で取り込み対象と同じ。追加の更新なし。

反映履歴は `1765-kenta-booking-ci-checks.md`。`git diff --cached --check` の確認後にコミットして引き継ぐ。push・PR操作・DB更新・配備・本当の送信や決済は行わない。今回の再検査範囲は依頼されたWorker・Adminの両ジョブで、ほかのジョブ全体を再実行したという意味ではない。
