# GitHub PR と Slack の同期

## 正本と役割

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

## PRゲートとの関係

- 必須ゲートはGitHubの `required-pr-gate` と、対象コードに必要なテスト・型検査・ビルドで判断する。
- `GitHub PR Slack Sync` は参考チェックとして扱う。失敗はActionsに表示するが、ジョブ全体は成功扱いにする。
- Slackへ届かなかった通知は、15分ごとの再照合または `workflow_dispatch` の手動実行で補う。
- Slack同期の失敗を無視してよいという意味ではない。原因調査は通知運用として続け、コードの統合判断とは分離する。

デザインの作り直しなどSlackへ自動掲出しないPRには `slack-sync-ignore` ラベルを付ける。ラベルの
追加・削除でも同期を実行し、指令塔の未完了PR一覧から即時に出し入れする。

## 有効化

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

## 切り戻し

1. `SLACK_PR_SYNC_ENABLED` を `false` にするか削除する。
2. 実行中のworkflowがあれば完了を待つ。`cancel-in-progress` は無効なので途中で別実行へ切り替わらない。
3. 必要であれば実装PRをrevertする。

この切り戻しでGitHub起点の新規通知と15分ごとの再照合が止まる。Codexフックによる補助通知と、
既存のSlackメッセージは残る。
