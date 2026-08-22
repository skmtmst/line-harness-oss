# CodexとSlackの共同開発運用

## 目的

ケンタとマサトのCodex作業をSlackで見えるようにし、同じ箇所の同時修正とコンフリクトを減らす。GitHubは今までどおり正本として使う。

## Slackでの起動ルール

| Slackの書き方 | Codexの動き |
| --- | --- |
| `@Codex` なし | 人間同士の会話のまま。正本化も実装もしない |
| `@Codex このスレッドを正本化して` | 会話を整理し、GitHub Issueまたは仕様書を作成・更新してURLを返す |
| `@Codex 正本化して実装へ進めて` | 正本化の後、専用ブランチとPRまで進める |
| `@Codex PR #220ができない原因を確認して。まず読み取りだけ` | 原因調査だけを行い、同じスレッドに報告する |

Slackのアプリ候補から選んだ実際の `@Codex` メンションが必要。文字で「Codexに確認」と書いただけでは起動しない。

## 振り分け

- PR・修正: PR番号を100件単位で振り分ける。PR #220は `#line-harness-pr-201-300`
- エラー・白画面・動かない: `#line-harness-エラー報告`
- アイデア・正本化: `#line-harness-アイデア`
- 承認待ち・競合・完了: `#line-harness-指令塔`
- 未完了タスク: `#line-harness-要対応`

各案件は1つの親メッセージにまとめ、作業開始、追加指示、Codexの結果はそのスレッドへ追記する。

## 自動報告の仕組み

1. リポジトリの `.codex/hooks.json` が、Codexの作業開始、承認待ち、作業終了をフックする。
2. `scripts/codex-slack-hook.ts` がリポジトリ、ブランチ、PR番号を付け、署名してWorkerへ送る。
3. Workerが署名を確認し、内容を分類して対象Slackスレッドへ投稿する。
4. Slackの `TASK-ID` からCodexセッションを記録し、後からPR番号が付いても元スレッドと要対応カードを更新する。
5. トークンやパスワードらしき文字は投稿前に伏せる。

## 要対応タスク

- 修正、エラー、承認待ちなど、対応が必要な投稿は `#line-harness-要対応` に自動表示する。
- 状態は `作業中` / `確認待ち`。SlackのボタンまたはCodexの完了報告で完了すると、要対応一覧から消える。
- 自動エラー報告の親投稿にも `TASK-ID` を表示する。同じ画面で同じHTTPエラーが連続した場合は、API失敗と未処理Promiseを同じタスクへまとめる。
- 消すのは要対応一覧の通知だけ。元のPR・エラー・アイデアのスレッドには完了履歴を残す。
- 新しいCodexチャットで続きを行う場合は、要対応メッセージの `TASK-ID` を先頭へ貼る。例: `TASK-0123456789ABCDEF この対応を進めて`。
- 同じPR番号または同じ専用ブランチから始めた場合は、`TASK-ID` がなくても同じタスクへ紐づく。

## エラー自動検知

- Workerで捕捉されなかった例外は、`#line-harness-エラー報告` と `#line-harness-要対応` へ自動送信する。
- 管理画面の白画面、未処理のJavaScriptエラー、未処理Promise、APIの5xx応答も自動送信する。
- 入力ミスなどの4xxは開発エラーとして自動起票しない。
- 同じ内容と画面のエラーは同じスレッドへ集約する。URLのクエリと顧客本文は送信しない。

## 必要な設定

Workerの秘密値:

- `CODEX_SLACK_RELAY_SECRET`: Codex側と共通の十分に長いランダム値
- `SLACK_BOT_TOKEN`: 内部SlackアプリのBot token。`chat:write` と対象チャンネルの履歴読み取り権限が必要
- `SLACK_SIGNING_SECRET`: Slackのボタン操作が本物か確認する署名秘密値

Workerの非秘密設定:

- `SLACK_COMMAND_CHANNEL_ID`
- `SLACK_ERROR_CHANNEL_ID`
- `SLACK_IDEA_CHANNEL_ID`
- `SLACK_DEFAULT_PR_CHANNEL_ID`
- `SLACK_PR_CHANNELS_JSON` 例: `{"1-100":"チャンネルID","101-200":"チャンネルID","201-300":"チャンネルID"}`
- `SLACK_KENTA_USER_ID`
- `SLACK_MASATO_USER_ID`
- `SLACK_TASK_CHANNEL_ID`

Slackアプリの Interactivity Request URL:

- `<Worker URL>/api/integrations/slack/actions`

ケンタとマサトのCodex実行環境:

- `CODEX_OPERATOR`: `kenta` または `masato`
- `CODEX_SLACK_RELAY_URL`: Workerの `/api/integrations/codex-slack/events`
- `CODEX_SLACK_RELAY_SECRET`: Workerと同じ秘密値
- `CODEX_SLACK_SYNC_REQUIRED=1`: 未設定や送信失敗をCodexの画面に警告する

macOSでは、Codexアプリが環境変数をまだ引き継いでいない場合も、`launchctl` の設定値と
キーチェーン（service=`line-harness-codex-slack-relay`、account=`kenta` または `masato`）を
自動で確認する。完了報告に `PR #246` のような番号がある場合は、その番号の100件単位チャンネルへ送る。

秘密値はリポジトリやSlackへ書かない。両名の環境設定が終わったらCodexを再起動し、プロジェクトフックを信頼済みにする。

## セキュリティと承認

- Slackへは顧客の個人情報や本文データを転記しない。
- リレーは送信時刻とHMAC署名を検証する。
- 正本化は仕様を固定する操作であり、マージやDB更新の承認ではない。
- 本番のマージ、DB更新、コード配備は従来の確認手順を省略しない。
