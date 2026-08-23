# GitHub PR と Slack の同期

## 正本と役割

- GitHubのPull Requestを、PR作成・更新・Draft変更・再開・クローズ・マージの正本とする。
- Codexフックは、作業開始・途中経過・承認待ちを補足する経路として残す。
- GitHub ActionsはPRイベントを検証Workerの署名付きリレーへ送り、PR番号ごとのSlackスレッドへ同期する。
- 毎時17分の再照合と手動実行で、GitHub ActionsまたはSlack APIの一時失敗による未通知を補う。

再照合では、Slackのメッセージmetadataを台帳として使う。既存のPRスレッドと要対応カードが
そろっていれば投稿せず、不足している親スレッドまたは要対応カードだけを作る。マージ済みPRに
未完了カードが残っている場合だけ、完了返信を追加してカードを閉じる。

## 有効化

有効化前に、検証Workerへ再照合対応コードが配備済みであることを確認する。

GitHubリポジトリの `Settings` → `Secrets and variables` → `Actions` で、次を登録する。

- Repository secret `CODEX_SLACK_RELAY_SECRET`
  - 検証Workerの同名Secretと同じ値。値をIssue、PR、ログ、チャットへ書かない。
- Repository variable `GITHUB_SLACK_PR_SYNC_ENABLED`
  - 有効化するときだけ `true`。未設定または他の値ならworkflow全体を実行しない。

Secretとvariableを登録した後、`Actions` → `GitHub PR Slack Sync` → `Run workflow` で
手動再照合を1回実行する。ログに出してよいのは送信件数と再照合件数だけである。

## 切り戻し

1. `GITHUB_SLACK_PR_SYNC_ENABLED` を `false` にするか削除する。
2. 実行中のworkflowがあれば完了を待つ。`cancel-in-progress` は無効なので途中で別実行へ切り替わらない。
3. 必要であれば実装PRをrevertする。

この切り戻しでGitHub起点の新規通知と定期再照合が止まる。Codexフックによる補助通知と、
既存のSlackメッセージは残る。

