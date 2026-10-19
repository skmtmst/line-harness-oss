> 文書：台本・CI・依存の整理と検査記録｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# S02C：台本・CI・依存の整理

土台は司令塔指定の `5b1b91c94c14ebb1a329592671286272d0c015f2`。PLAN-COVERAGEとLONG-FILESのS02C割当はともに0件。外部のS02-PREP・S04-to-S02・F01/G02等の引き継ぎと、整理段2の共通契約に従う。

## 変更

台本42件を用途ごとにgit mvし、相対import・読込先・CLIの起動条件・CI/packageの呼出し・Codexの既存フックの道を更新した。従来のdry-run命令名を維持し、世代名のない入口も用意した。scripts/README.mdから各入口を探せる。

未使用の旧V6専用HTML抽出2本だけを削除した。動きを守る試験・ブラウザ検査・復旧用の入口・手動の設計測定は保持した。既存scriptsの単体試験88ファイル、ブラウザspec3ファイルと、既存の検査式の数は不変。

未使用のビルド入力VITE_BOT_BASIC_IDをCI3本から除去した。実行時の公開botBasicIdと友だち追加の機能は維持。apps/packagesのソースは変更せず、そこから直接importされる4ファイルと残る2か所の未使用入力はS02Zへ渡す。

依存の直接宣言130件は削減せず、使用確認済みの部品を保持。TypeScript/tsup/Node型の指定を統一し、Node22のCIと手元が同じlockfileの型を使うようにした。@hono/node-server・qs・body-parser・@babel/coreを互換範囲の修正版へ上げた。pnpm auditは高1/中5/低4から高1/中0/低2へ減少し、未解決を隠していない。[node-serverの公開情報](https://github.com/advisories/GHSA-92pp-h63x-v22m)と[bracesの公開情報](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)も照合した。

## 検証

- doctor：合格。Node22/pnpm9.15.4でfrozen install、scripts型検査、Workflow接続、Python17試験、シェル/MJS構文14件が成功。
- 依存の安全な版の検査11件と、ソース固定検査の故障対照53件が成功。新しいソース固定0件。削除した動作試験0件。しきい値・例外・許可の追加0件。
- 初回scripts全体は共有パッケージのbuild不足と移動後の読込元3か所で失敗した。共有buildを検査の前提に追加し、相対読込を修正した。原ログは外部S02C-EVIDENCE/scripts-first.logに保持する。修正後の移行安全検査・CI接続50件は成功。単独の全試験はまだ開始しないまま共有枠を待っていたため、自分の待機だけを取り消して、共有buildとscripts全試験を含む全体ci-localへ統合する。全体検査はこれからであり、完了として扱わない。

外部の証拠は司令塔の `design/v8/review/CLEANUP-1017/S02C-EVIDENCE/`、全215台本の対応表は `S02C-SCRIPTS.tsv`。移動後の依存と参照はscript-references.json、数字はcounts.json、検査式の比較はtest-preservation.json。

## 統合担当へ

最新開発枝8c1fe563daを取得しmergeしたところ、担当外の画面4ファイルに競合が出たためabortした。司令塔指定のF01土台を保ち、画面の競合を独自判断で変更しなかった。場所はbase-status.json。文書43参照と保留5ファイル・設定2か所はAPI-CONTRACT-S02C.mdに記載した。新migration/番号案・DB適用・配備・実送信・決済・外部投稿・push・PRはない。

外部HQの `ci-all.sh` が使う `scripts/check-migrations.ts` も元の入口を保持する。S02Z/司令塔が外部命令と同時に移し、安全検査の呼出しを切らない。
