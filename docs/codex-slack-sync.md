> 文書：CodexとSlackの共同開発運用｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# CodexとSlackの共同開発運用

## 目的

ケンタとマサトのCodex作業をSlackで見えるようにし、同じ箇所の同時修正とコンフリクトを減らす。GitHubは今までどおり正本として使う。

## Slackでの起動ルール

| Slackの書き方 | Codexの動き |
| --- | --- |
| `@Codex` なし | 人間同士の会話のまま。正本化も実装もしない |
| `@Codex このスレッドを正本化して` | 会話を整理し、GitHub Issueまたは仕様書を作成・更新してURLを返す |
| `@Codex 正本化して実装へ進めて` | 正本化の後、専用ブランチで実装・検査・コミット。push・PR・統合は司令塔が行う |
| `@Codex PR #220ができない原因を確認して。まず読み取りだけ` | 原因調査だけを行い、同じスレッドに報告する |

Slackのアプリ候補から選んだ実際の `@Codex` メンションが必要。文字で「Codexに確認」と書いただけでは起動しない。

## 振り分け

- PR・修正: PR番号を100件単位で振り分ける。PR #220は `#line-harness-pr-201-300`
- 各区切りの末尾11件に入ると、次の100件用チャンネルを先行作成する。PR #290〜#300では `#line-harness-pr-301-400` を準備し、PR #301から自動で使う
- 次チャンネルの作成や1人の招待に失敗しても、現在のPR報告と残りの招待は止めない。末尾11件の各PRで再試行し、失敗内容はWorkerログへ残す
- エラー・白画面・動かない: `#line-harness-エラー報告`
- アイデア・正本化: `#line-harness-アイデア`
- 承認待ち・競合・完了: `#line-harness-指令塔`
- 未完了タスク: `#line-harness-要対応`

各案件は1つの親メッセージにまとめ、作業開始、追加指示、Codexの結果はそのスレッドへ追記する。

## 自動報告の仕組み

1. リポジトリの `.codex/hooks.json` が、Codexの作業開始、承認待ち、作業終了をフックする。
2. `scripts/slack/codex-slack-hook.ts` がリポジトリ、ブランチ、PR番号、未完了PRの状態と変更重複を付け、署名してWorkerへ送る。
3. Workerが署名を確認し、内容を分類して対象Slackスレッドへ投稿する。
4. Slackの `TASK-ID` からCodexセッションを記録し、後からPR番号が付いても元スレッドと要対応カードを更新する。
5. トークンやパスワードらしき文字は投稿前に伏せる。

## Slackメンションのイベント駆動監視

5分ごとのSlack検索は使わない。内部SlackアプリがSlack Eventsを受け取った時だけ、次の処理を起動する。

1. `POST /api/integrations/slack/events` でSlack署名を検証する。
2. `team_id`、`channel_id`、投稿者IDを環境別の許可リストと照合する。許可外のワークスペースまたはチャンネルはD1へも保存せず捨てる。
3. 本文に実際のCodexユーザーID `<@U0BRUBQMV9Q>` があり、1行目が `[claude->codex]` で始まる依頼だけを自動中継候補にする。文字列の `@Codex` は無視する。
4. 実メンションでもマーカーが無い投稿はD1台帳へ記録するだけで、Queueへ送らない。Masatoが手動で公式Codexへ話しかけた投稿との混同を防ぐ。
5. Slackの再送や `app_mention` / `message` の重複は `(channel_id, message_ts)` で1件にまとめる。依頼本文はD1へ保存しない。
6. Cloudflare Queueで30秒後に状態を確認する。この猶予中に公式Slack Codexのタスクリンク、明示的な着手返信、完了返信を受信したら何もしない。
7. 受領が無い場合は同じスレッドをもう一度照合し、MasatoのUser OAuthで `【Claude依頼の自動中継】` マーカー付きの実メンションを1回だけ投稿する。この投稿は通常のコード変更を専用ブランチ・テスト・`codex/development` 宛て下書きPRまで進める依頼であり、本番、DB、配備、外部設定、秘密情報の承認ではない。
8. 中継後5分以内に公式Codexの受領を確認できなければ再中継せず、D1を `failed` にして同じスレッドへ通知する。中継マーカー付き投稿は受信側で無視し、再帰中継を防ぐ。

`CODEX_RELAY_ENABLED=false` で、コード変更なしに自動中継を止められる。Queueは最大5回まで試行し、最終失敗時は例外本文を保存・出力せず `db_error` / `slack_api_error` / `unknown` だけをログへ出し、D1を `failed` にして明示的に終了する。普段の待機中にCodexモデルは起動せず、追加のOpenAI API課金も使用しない。

## Claude監査合格PRの自動マージ

自動中継とは別の機能として、Claudeの監査合格合図だけを `skmtmst/line-harness-oss` の `codex/development` へ統合できる。1行目と合格行は次の完全一致書式に限定する。

```text
[claude->codex]
【監査結果】PR #NNN HEAD <40桁のコミットSHA> 合格・統合可
```

- Slack署名、workspace、channel、投稿者の既存許可リストをすべて通過した投稿だけをQueueへ送る。合格行が無い、書式が違う、投稿者が許可外なら処理しない。
- Slack親メッセージの `line_harness_codex` metadataにある `work_key=pr:NNN` と、合図のPR番号が完全一致しなければ停止理由をスレッドへ返す。合格合図には監査したHEADの40桁SHAも必須とし、現在のPR HEADと一致しなければ再監査を求めて停止する。
- PRのbaseは `codex/development` 固定。`main` を指定または更新する経路はない。
- DBマイグレーション、認証・テナント境界ファイル、環境ファイル、秘密値・secret追加の疑いがある差分は停止する。
- `Required PR gate` と、Slack同期を除く最新check run・commit statusが完了・成功しており、GitHubの競合判定が `clean` または参考用Slack同期だけによる `unstable` の場合だけマージする。マージ直前にもbase SHA、head SHA、チェックを再確認する。
- GitHub PRコメントの `codex-auto-merge-ledger:v1` マーカーとGitHubのマージ状態を台帳として使う。同じPRを再マージしない。DBテーブルとマイグレーションは追加しない。
- `codex-auto-merge-excluded` ラベルまたはdraft状態のPRは自動対象外。仕組み自体を導入するM-1 PRにはこのラベルを付け、Masatoが手動で統合する。

`CODEX_AUTO_MERGE_ENABLED` は `CODEX_RELAY_ENABLED` と独立している。未設定・`false` のときも合格合図とスレッドのPR番号までは検知するが、GitHubを呼ばず「検知のみ」と報告する。検証環境の初期値は `false`。有効化はM-1 PRの手動統合と検証確認の後、別の外部設定変更として行う。本番では有効化しない。

## 要対応タスク

- 修正、エラー、承認待ちなど、対応が必要な投稿は `#line-harness-要対応` に自動表示する。
- 状態は `作業中` / `確認待ち`。SlackのボタンまたはCodexの完了報告で完了すると、要対応一覧から消える。
- 自動エラー報告の親投稿にも `TASK-ID` を表示する。同じ画面で同じHTTPエラーが連続した場合は、API失敗と未処理Promiseを同じタスクへまとめる。
- 消すのは要対応一覧の通知だけ。エラー報告の親投稿は削除せず、`作業中` / `確認待ち` / `完了` を更新して結果が一覧から分かるようにする。元のPR・エラー・アイデアのスレッドにも完了履歴を残す。
- 新しいCodexチャットで続きを行う場合は、要対応メッセージの `TASK-ID` を先頭へ貼る。例: `TASK-0123456789ABCDEF この対応を進めて`。
- 同じPR番号または同じ専用ブランチから始めた場合は、`TASK-ID` がなくても同じタスクへ紐づく。

## 開発指令盤

`#line-harness-指令塔` には、更新され続ける「LINE Harness 開発指令盤」を1件だけ置く。

- 未完了PRは番号順に並べ、専用ブランチ名からケンタ・マサトの担当を表示する。
- PRの作成自体はいつでも可能。先に統合してよいかは、古いPRのDraft状態、チェック、競合、変更ファイルの重複で判定する。
- 古いPRがDraftで、変更箇所が重ならない後続PRは「追い越し候補」とする。変更が重なる場合は「追い越し不可」と重複先のPR番号を表示する。
- 作業中と確認待ちのTASK-ID、停止理由、開発・検証・本番の反映状況、同じPRや元スレッドに対する重複タスクをまとめて表示する。
- GitHubのIssue・仕様書・PRが正本で、指令盤は順番と現在地を一目で確認するための表示とする。

## エラー自動検知

- Workerで捕捉されなかった例外は、`#line-harness-エラー報告` と `#line-harness-要対応` へ自動送信する。
- 管理画面の白画面、未処理のJavaScriptエラー、未処理Promise、APIの5xx応答も自動送信する。
- 入力ミスなどの4xxは開発エラーとして自動起票しない。
- 同じ内容と画面のエラーは同じスレッドへ集約する。URLのクエリと顧客本文は送信しない。

## 必要な設定

Workerの秘密値:

- `CODEX_SLACK_RELAY_SECRET`: Codex側と共通の十分に長いランダム値
- `CODEX_SLACK_RELAY_SECRET_KENTA` / `CODEX_SLACK_RELAY_SECRET_MASATO`: 任意の個人別秘密値。共通値を変えずに各Macの送信経路を追加・交換できる
- `SLACK_BOT_TOKEN`: 内部SlackアプリのBot token。`chat:write`、対象チャンネルの履歴読み取り、公開チャンネルの参照・作成（`channels:read` / `channels:manage`）権限が必要
- `SLACK_SIGNING_SECRET`: Slackのボタン操作が本物か確認する署名秘密値
- `CODEX_SLACK_MONITOR_SIGNING_SECRET`: Codex監視専用SlackアプリのEvents API署名秘密値。設定時は `/api/integrations/slack/events` だけで優先し、既存アプリの `SLACK_SIGNING_SECRET` を変更しない
- `SLACK_USER_TOKEN`: MasatoのOAuth認可で発行されたUser token。同じSlackスレッドの再照合と、許可済みClaude依頼の公式Codexへの中継だけに使う
- `CODEX_AUTO_MERGE_GITHUB_TOKEN`: `skmtmst/line-harness-oss` だけに限定したfine-grained GitHub token。ContentsとPull requestsのwrite、Checksのreadだけを許可し、値はリポジトリやSlackへ書かない

Workerの非秘密設定:

- `SLACK_COMMAND_CHANNEL_ID`
- `SLACK_ERROR_CHANNEL_ID`
- `SLACK_IDEA_CHANNEL_ID`
- `SLACK_DEFAULT_PR_CHANNEL_ID`
- `SLACK_PR_CHANNELS_JSON` 例: `{"1-100":"チャンネルID","101-200":"チャンネルID","201-300":"チャンネルID"}`。既存範囲の固定先に使い、PR #301以降の新しい範囲はSlackのチャンネル名から自動解決する
- `SLACK_KENTA_USER_ID`
- `SLACK_MASATO_USER_ID`
- `SLACK_TASK_CHANNEL_ID`
- `CODEX_SLACK_USER_ID`: 監視対象の公式CodexユーザーID。LINE 然では `U0BRUBQMV9Q`
- `CODEX_ALLOWED_TEAM_IDS`: 監視を許可するSlack workspaceのteam ID。カンマ区切り
- `CODEX_ALLOWED_CHANNEL_IDS`: Masato名義の自動中継を許可するSlack channel ID。カンマ区切り。完全一致したIDはSlack API照合なしで許可する
- `CODEX_ALLOWED_CHANNEL_NAME_PREFIXES`: 自動生成される帯チャンネル名の許可接頭辞。カンマ区切り。Slack APIの `conversations.info` で取得した実名が「接頭辞＋3桁-3桁」で終わる場合だけ許可し、未設定・API失敗・不一致は拒否する
- `CODEX_RELAY_SOURCE_USER_IDS`: `[claude->codex]` 投稿を許可する投稿者ID。ClaudeがMasato名義で投稿する構成ではMasatoのSlack user IDだけを設定する
- `CODEX_RELAY_ENABLED`: 自動中継のキルスイッチ。`true` / `1` のときだけ中継し、検証配備時の初期値は `false`
- `CODEX_AUTO_MERGE_ENABLED`: 監査合格PRマージの独立スイッチ。`true` / `1` のときだけマージし、未設定・`false` は検知のみ。検証環境の初期値は `false`
- `CODEX_AUTO_MERGE_REPOSITORY`: 固定値 `skmtmst/line-harness-oss`。別の値は停止する
- `CODEX_QUEUE_MAX_ATTEMPTS`: Queue失敗をD1の `failed` として確定する試行回数。検証環境はQueue設定と同じ `5`
- `CODEX_OFFICIAL_RECEIPT_GRACE_SECONDS`: 公式Slack Codexの受領を待つ秒数。既定は30秒、許容範囲は10〜300秒

Slackアプリの Event Subscriptions:

- Request URL: `<Worker URL>/api/integrations/slack/events`
- User events（MasatoのOAuth認可）: `message.channels`, `message.groups`, `message.im`, `message.mpim`
- User token scopes: `channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`。発行されたUser tokenは `SLACK_USER_TOKEN` としてWorker secretに保存する
- Bot token scope: `chat:write`。状態通知を投稿するチャンネルには内部Slackアプリを参加させる
- 帯チャンネルの自動作成時は `SLACK_KENTA_USER_ID`、`SLACK_MASATO_USER_ID` に加えて、設定済みなら `CODEX_SLACK_USER_ID` も招待する。Codex ID未設定時は従来の2人だけで継続する
- `app_mention` は「その内部Slackアプリ自身」へのメンションだけを送るため、別アプリである公式Codexの監視には使わない
- 設定変更後はMasatoのOAuth認可とワークスペースへの再インストールを行う。認可したユーザーが見られない非公開チャンネルやDMは監視対象にならない

Cloudflare検証環境:

- Queue: `nen-codex-mentions-stg`
- Producer / Consumer binding: `CODEX_MENTION_QUEUE`
- D1 migration: `180_codex_cloud_tasks.sql`

Queue作成、D1適用、Worker secrets登録、OAuth再認可、Event Subscription登録、自動マージスイッチの有効化は外部状態を変える。コードのPRとは分け、対象環境・バックアップ・切り戻しを確認してから検証環境だけへ適用する。M-1のコード配備ではDB更新を行わず、`CODEX_AUTO_MERGE_ENABLED=false` を維持する。

Slackアプリの Interactivity Request URL:

- `<Worker URL>/api/integrations/slack/actions`

ケンタとマサトのCodex実行環境:

- `CODEX_OPERATOR`: `kenta` または `masato`
- `CODEX_SLACK_RELAY_URL`: Workerの `/api/integrations/codex-slack/events`
- `CODEX_SLACK_RELAY_SECRET`: Workerの共通値、または自分用の個人別秘密値
- `CODEX_SLACK_SYNC_REQUIRED=1`: 未設定や送信失敗をCodexの画面に警告する

macOSでは、Codexアプリが環境変数をまだ引き継いでいない場合も、`launchctl` の設定値と
キーチェーン（service=`line-harness-codex-slack-relay`、account=`kenta` または `masato`）を
自動で確認する。完了報告に `PR #246` のような番号がある場合は、その番号の100件単位チャンネルへ送る。

秘密値はリポジトリやSlackへ書かない。両名の環境設定が終わったらCodexを再起動し、プロジェクトフックを信頼済みにする。
個人別秘密値を使う場合、ケンタのMacには `CODEX_SLACK_RELAY_SECRET_KENTA` と同じ値、
マサトのMacには `CODEX_SLACK_RELAY_SECRET_MASATO` と同じ値だけを保存する。

## PCとスマホからの確認

- 共通の正本は、メンションを書いた元Slackスレッド。公式Codexのクラウドタスクリンク、承認待ち、完了、失敗が同じ場所に残る。
- PCのCodexアプリから確認するときは、Slackスレッド内のChatGPTリンクを開く。Slack起動のクラウドタスクがCodexデスクトップのタスク一覧へ必ず同期されるとは限らないため、リンクを確実な入口にする。
- PC上のCodexが機械的に一覧確認する場合は、検証Workerの `GET /api/integrations/codex-monitor/status?limit=20` を使う。`Authorization: Bearer <API_KEY>` が必須で、依頼本文や秘密値は返さない。
- スマホはSlackアプリの同じスレッドから通知と状態を確認し、リンクをChatGPTアプリまたはブラウザで開く。承認待ちの場合も同じリンクから判断する。
- 自動中継は公式Slack Codexを使うため、最終内容はChatGPTクラウドタスクとSlack報告で確認する。

## セキュリティと承認

- Slackへは顧客の個人情報や本文データを転記しない。
- リレーは送信時刻とHMAC署名を検証する。
- 正本化は仕様を固定する操作であり、マージやDB更新の承認ではない。
- 本番のマージ、DB更新、コード配備は従来の確認手順を省略しない。

## PRの同期

### 正本と役割

- GitHubのPull Requestを、PR作成・更新・Draft変更・再開・クローズ・マージの正本とする。
- Codexフックは、作業開始・途中経過・承認待ちを補足する経路として残す。
- GitHub ActionsはPRイベントを検証Workerの署名付きリレーへ送り、PR番号ごとのSlackスレッドへ同期する。
- 15分ごとの再照合と手動実行で、GitHub ActionsまたはSlack APIの一時失敗による未通知を補う。

再照合では、Slackのメッセージmetadataを台帳として使う。既存のPRスレッドと要対応カードが
そろっていれば投稿せず、不足している親スレッドまたは要対応カードだけを作る。マージ済みPRは
親投稿の完了状態を台帳として扱い、完了返信を1回だけ追加してカードを閉じる。指令塔の更新は
PR通知とは別の最終処理として実行する。同期に失敗した場合はActionsの警告とサマリーへ残し、
次回の定期再照合へつなぐ。ただし、Slackは作業状況を見えるようにする補助経路であり、
コード品質を判定する経路ではないため、**Slack同期の失敗だけでPRのマージを止めない**。

### PRゲートとの関係

- 必須ゲートはGitHubの `required-pr-gate` と、対象コードに必要なテスト・型検査・ビルドで判断する。
- `GitHub PR Slack Sync` は参考チェックとして扱う。失敗はActionsに表示するが、ジョブ全体は成功扱いにする。
- Slackへ届かなかった通知は、15分ごとの再照合または `workflow_dispatch` の手動実行で補う。
- Slack同期の失敗を無視してよいという意味ではない。原因調査は通知運用として続け、コードの統合判断とは分離する。

デザインの作り直しなどSlackへ自動掲出しないPRには `slack-sync-ignore` ラベルを付ける。ラベルの
追加・削除でも同期を実行し、指令塔の未完了PR一覧から即時に出し入れする。

### 有効化

有効化前に、検証Workerへ再照合対応コードが配備済みであることを確認する。

GitHubリポジトリの `Settings` → `Secrets and variables` → `Actions` で、次を登録する。

- Repository secret `CODEX_SLACK_RELAY_SECRET`
  - 検証Workerの同名Secretと同じ値。値をIssue、PR、ログ、チャットへ書かない。
- Repository variable `SLACK_PR_SYNC_ENABLED`
  - 有効化するときだけ `true`。未設定または他の値ならworkflow全体を実行しない。
- Repository variable `SLACK_COMMAND_CENTER_STRICT_ENABLED`
  - 検証Workerの配備後にだけ `true` にする。配備前は未設定のままにし、新旧Workerの切替中に誤ったPR通知を作らない。

Secretとvariablesを登録した後、`Actions` → `GitHub PR Slack Sync` → `Run workflow` で
手動再照合を1回実行する。テスト通知を1件だけ確認するときは `pr_number` に対象PR番号を
入れる。空欄なら通常どおり、監査開始番号以降の未通知PRをまとめて再照合する。
ログに出してよいのは送信件数と再照合件数だけである。

### 切り戻し

1. `SLACK_PR_SYNC_ENABLED` を `false` にするか削除する。
2. 実行中のworkflowがあれば完了を待つ。`cancel-in-progress` は無効なので途中で別実行へ切り替わらない。
3. 必要であれば実装PRをrevertする。

この切り戻しでGitHub起点の新規通知と15分ごとの再照合が止まる。Codexフックによる補助通知と、
既存のSlackメッセージは残る。
