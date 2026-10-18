# L01：本番公開の順序と検査（2026-10-19）

指定枝 `codex/kenta-train-cleanup-l01-1018`、土台 `7b42fc5e44`。
開始時のLINE作業木・親EC作業木はclean、doctor LOCALは合格。
本番・検証のCloudflare、DB、実送信、決済、GitHubへの書込みは実行していない。
この変更は公開の準備であり、公開済みの宣言ではない。

## 実装

- 入口は `deploy-cloudflare-production.yml` のworkflow_dispatchだけ。main pushでの
  Worker/Adminの個別配備を撤去し、両方とDBを再利用Workflowにする。
- production Environmentの承認、承認者の実在照合、全工程の共通排他を使う。
  standaloneの本番DB適用を止め、認証情報の本番移行も共通排他に参加させる。
- 検証runの出所・成功・公開SHA照合の成功を確認し、現在の検証Worker/Adminの
  完全SHAも照合する。mainへの包含とGit tree完全一致により、開発枝で検証した
  SHAをマージ後もそのまま公開する。短縮・不明・別SHAは拒否する。
- 依存のinstallより前にmainとの包含・tree・checkoutを検査する。以降もcleanと
  mainの変更を確認する。追跡ファイルのstampをせず生成物へBUILD_*を注入する。
- SELECTだけで未適用を数え、SQLファイル・順序・SHA256の明示承認と照合する。
  復元点とSQLを暗号化して非公開R2へ保存し、読戻し・復号が成功してから適用する。
  直前の一覧変更、未承認SQL、保存・読戻し失敗はDB書込みより先に拒否する。
- Workerは未適用0件の確認だけを行い、DBを変更しない。生成物の経路、公開設定、
  routes・D1/R2の結び付け・互換flagを正本と照合し、両アプリの_headersを検査する。
  管理画面は全出力HTMLで実行可能なinline scriptと外出しファイルの欠落も検査する。
- 配備後はWorker生成/静的HTML・資産・JSON・401/404、管理画面HTML・資産・JSON・404を
  種類別に検査する。JSONにHTML用CSPを要求しない。403/500は故障を実環境へ起こさず
  手元で応答検査を試験する。ログは合否と公開SHAだけ。通常artifactへSQLを出さない。
- Pagesは本番project・生成物のSHAを照合しbranch=main/commit-hashを固定する。
  canonical deploymentと両公開SHAが一致しなければ成功にしない。
- 通常PRゲートにactionlint、Workflow構造/故障対照、実ビルド後のオフライン生成物検査を
  接続する。既存の安全・権限・別店・操作・崩れ・DB・lockfile検査は削除しない。

## 変更範囲と試験の対応

L01のprimaryBundleと長いファイルのbundleはともに0件。
旧計画IDのL01はG01の項目なので持ち込んでいない。
削除・改名・移動した既存ファイルと試験は0。

`deploy-cloudflare-worker-artifact.test.ts` は、固定名やコメント文字列の照合から
実際のartifactパス導出と設定の差を拒否する試験へ更新した。元の互換flag・欠落・
正しい生成物だけを配備する守りは、実関数の正常/故障で残す。
`migrate-d1-workflow.test.ts` はDBの担当を新しい子と補助関数へ移した分だけ追随し、
既存stagingのSELECT-only、復元点先行、冪等な台帳記録、Environment/秘密名を維持する。
新設のproduction試験では、承認SHA、staging証拠、順序、SQL承認、暗号化・保管・破損、
公開応答と配備引数を偽のサービスと一時ファイルで検査する。

実装パスの行数・ファイル数・全対応表は、外部 `CLEANUP-1017/L01-EVIDENCE/` の
`files-and-counts.json`、`counts-summary.json`、`files-and-tests.tsv` に記録する。

## 検証

重点試験102件（配備安全の既存試験と欠落/後回し・Worker名不備の対照を含む）、scripts型、Workflow構造と故障対照、既存接続検査11件、
actionlint 1.7.7、全WorkflowのYAML/run shell 226工程、差分検査が成功。
Worker・管理画面の実ビルドと生成設定/見出し検査が成功（直接実行はNode26）。
管理画面211生成ページ、HTML208枚・外出しスクリプト644個の存在とinline除去を確認。
新設補助の相対importの循環は0。ci-local（Node22）は試験追随後に全体と最終修正の関連ジョブを完走した。
実際のGitHub配備Workflow、Cloudflareへの設定変更・DB操作・配備は実行しない。
画面の実装変更0のため、L01固有のPencil/撮影の対象はない。

## 司令塔へ残す判断・運用

- 本番Environmentの承認者・秘密・公開キー・project名の準備、バックアップ専用R2と
  保存日数・アクセス・消去日・鍵の保管・復旧訓練をオーナー承認する。未設定なら
  DB適用前に止まる。予約・通知の停止と再開も既存の運用手段で確認する。
  operations_pausedは申告であり、自動で予約や通知を止める機能を足したものではない。
- workers_devとpreviewの既定は元のまま。Webhook/LIFF/OAuthの登録先確認が先。
  HSTSはCloudflare側の別承認。いずれも本作業では変更していない。
- `docs/v8-requirements/v8-switch.md`のmain push配備という説明と、
  `docs/migration-runbook.md`のWorkerによる自動DB適用という説明は、司令塔の正規の
  文書更新へ渡す。本番・公開条件の承認をこの変更で省略しない。
- 検査前fetchの本線は `89361a99b8772133bd5dacb4ce775f16d267b6fc`。
  #1773の取り込みはM03の持ち場なので、指定土台から勝手に入れ替えていない。
- migration・表・列の追加は不要で、番号案も不要。上限・許可先・依存・lockfile・
  staging配備Workflow・画面・親ECは変更していない。
- 反映履歴は指示された#0000。正式採番と通常PRゲート、push/PR/統合は司令塔。

## 最初のci-localと試験の追随

`f09d1f6da0` のrunは、root scriptsの古い配備コマンド名の照合2件で失敗したため中止。
実装の先行検査は残っていたが、配備を値を出さない共通の入口へ移したため、
`scripts/security/deployment-safety.test.ts` の探索先が見つからなかった。
新しい実行行を対象にし、Workerはソースと生成物の2回、Adminとstagingは各1回の
検査が配備前にあることを維持。検査を外す・配備後へ回す対照も追加した。
同ファイルの設定・別環境・秘密・R2・CORSの既存試験は残し、直接100件と型が成功。
製品・Workflow・ビルド入力の変更は0。最初の失敗ログは削除しない。

初回log: `~/lh-work/tools/hq/ci-local/logs/20261019-011726-f09d1f6da0-29058/`。
中止時のMac用ci-local cleanupで既知のPermissionErrorが出た。自分の残存processが0、
自分の一時worktreeがcleanであることを確認し、そのworktreeだけ通常のremoveで片付けた。
他束のprocess・worktree・共用ツールは変更していない。

## 本番の名前もDB更新より先に照合

Worker名が未設定/別名でも、以前の入口はソース名へのfallbackで通り、生成物の確認で
DB更新後に止まる余地があった。新しい失敗対照2件で、修正前は2失敗/8成功を確認した。
公開の入口でWorker名・Pagesの本番project・公開キーを確認し、親WorkflowもWorker名を
明示して渡すようにした。修正後は関連102件・scripts型・構造/故障対照・actionlintが成功。
本番/検証の設定変更はしていない。変更は配備補助とその試験・親のenvだけで、
apps/・packages/の製品入力と既存のアプリ検査ジョブ定義はcecbから変更0。
cecbの全体CIを完走した。cf13ではRoot検査・型・Workflowを追加実行して成功した。
apps/・packages/・buildジョブ・check-build.tsと生成物を検査する関数は不変なので、
両ビルドと機能検査の結果はcecbに紐付けて保持し、同じ入力での重複ビルドはしない。
差分と適用範囲は外部followup-input-proof.jsonに記録する。

## 全体ci-localの最終結果（cecb583e38）

`~/lh-work/tools/hq/ci-local/run.sh`を指定土台7b42fc5e44と、GitHubの個別変数APIで
未設定を確認した4変数の実効値（空）で実行した。秘密や値を証拠へ転記しない。
正式log: `~/lh-work/tools/hq/ci-local/logs/20261019-012350-cecb583e38-49383/`。

- root scripts: 124ファイル、1,107成功・既存skip 1。scripts型も成功。
- Worker: 1,135ファイル、13,436成功、型・実ビルド・追加生成設定/見出し検査成功。
- LIFF: 100ファイル、582成功、型・公開エントリ/見出し/SDKの実ブラウザ検査成功。
- 管理画面: 2,309ファイル、13,637成功、lint・型・Webhookブラウザ検査成功。
  実ビルド（HTML208/外出しscript644）、追加見出し/全HTML検査と既存の権限・切替・
  通知・タグ・MFA三幅・認証/見出し・設計・ブラウザ検査も成功。
- DBの安全検査・bootstrap、shared、self-update、CLI、SDK/MCPの試験・型・build、
  文書サイト試験、actionlintとWorkflow構造/故障対照も成功。
- DB本体の試験とV8 screen guardは、それぞれDB/画面入力の変更0により、
  既存のscope判定で対象外。
- 正式PR未作成なので`github.event.pull_request.title`が不明となり、反映履歴ゲートは
  未実行。この結果を受けて集約ゲートが失敗し、**run全体の終了は1（合格ではない）**。
  他の実行可能な工程に失敗0。題名・番号を捏造したり、skip記号で迂回したりしていない。
  #0000の独立書式検査は通常ゲートの検査文を無改変で使って成功したが、正式PR検査を
  代替しない。正式採番後の反映履歴更新と通常PRゲートは司令塔が実行する。

全体CIの一時worktree・processは終了時に片付き、LINE作業木はcleanだった。

## 最終修正の追加ci-local（cf13cc2d87）

`--job changes --job repository-checks`で同じ土台・変数を使った。
正式log: `~/lh-work/tools/hq/ci-local/logs/20261019-035415-cf13cc2d87-85199/`。
Root 124ファイル・1,109成功/既存skip 1、scripts型、共通型/試験（UTC・Bangkok）、
LIFF 100ファイル・582成功/型、共通build、DB bootstrap/安全、更新/CLI試験、
既存所有/見た目契約、Workflow構造/故障対照・actionlint・shellがすべて成功。
工程の失敗0・未評価1で**終了2**。未評価は同じ正式PR情報の不足だけで、
部分検査を全体CIの合格とは呼ばない。両runのログとSHAを分けて保存する。

この記録の最後のコミットはQA文書だけ。実装の検査対象はcf13、全体のアプリ入力は
cecbと同一であり、文書の追記を検査済みの製品コードに混ぜて申告しない。
削除/改名/移動した既存ファイル・試験0、migration0、親ECの変更0。
DONE-L01.tsvの4区分と計数/対応表は外部CLEANUP-1017へ記録する。
