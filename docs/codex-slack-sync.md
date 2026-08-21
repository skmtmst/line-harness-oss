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

各案件は1つの親メッセージにまとめ、作業開始、追加指示、Codexの結果はそのスレッドへ追記する。

## 自動報告の仕組み

1. リポジトリの `.codex/hooks.json` が、Codexの作業開始、承認待ち、作業終了をフックする。
2. `scripts/codex-slack-hook.ts` がリポジトリ、ブランチ、PR番号を付け、署名してWorkerへ送る。
3. Workerが署名を確認し、内容を分類して対象Slackスレッドへ投稿する。
4. トークンやパスワードらしき文字は投稿前に伏せる。

## 必要な設定

Workerの秘密値:

- `CODEX_SLACK_RELAY_SECRET`: Codex側と共通の十分に長いランダム値
- `SLACK_BOT_TOKEN`: 内部SlackアプリのBot token。`chat:write` と対象チャンネルの履歴読み取り権限が必要

Workerの非秘密設定:

- `SLACK_COMMAND_CHANNEL_ID`
- `SLACK_ERROR_CHANNEL_ID`
- `SLACK_IDEA_CHANNEL_ID`
- `SLACK_DEFAULT_PR_CHANNEL_ID`
- `SLACK_PR_CHANNELS_JSON` 例: `{"201-300":"C0BSNTKHB7A"}`
- `SLACK_KENTA_USER_ID`
- `SLACK_MASATO_USER_ID`

ケンタとマサトのCodex実行環境:

- `CODEX_OPERATOR`: `kenta` または `masato`
- `CODEX_SLACK_RELAY_URL`: Workerの `/api/integrations/codex-slack/events`
- `CODEX_SLACK_RELAY_SECRET`: Workerと同じ秘密値
- `CODEX_SLACK_SYNC_REQUIRED=1`: 未設定や送信失敗をCodexの画面に警告する

秘密値はリポジトリやSlackへ書かない。両名の環境設定が終わったらCodexを再起動し、プロジェクトフックを信頼済みにする。

## セキュリティと承認

- Slackへは顧客の個人情報や本文データを転記しない。
- リレーは送信時刻とHMAC署名を検証する。
- 正本化は仕様を固定する操作であり、マージやDB更新の承認ではない。
- 本番のマージ、DB更新、コード配備は従来の確認手順を省略しない。
