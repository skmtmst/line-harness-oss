> 文書：安全監視：画面とAPIの契約（B-343）｜区分：今の正本｜最終確認：2026-10-19（日本時間）

# 安全監視：画面とAPIの契約（B-343）

2026-10-16 / kenta・Codex。追加依頼を動きの仕様とする。画面・Pencilは変更しない。**691は予約番号の利用を明示されたため作成のみ。DB適用・本番/検証の設定・配備・実Slack送信はしていない。** 本組の承認番号はB-344の691〜695。689・690はbehaviorfixが使用する。

## API

すべて既存の管理者ログイン・CSRF・所属検査の対象。画面側は `apps/web/src/lib/api/helpers/security-monitor.ts` の `securityMonitorApi` を使う（共通 `fetchApi` 経由）。共有の型は `packages/shared/src/security-monitor.ts`。

一覧・受領・解消の6経路と検証専用の1経路は`GET /openapi.json`にも掲載。入力・返却値・エラーの記載は`apps/worker/src/routes/security-monitor-openapi.ts`。既存の仕様と同じ確認表で、記載の欠落を検査する。

| メソッド・パス | 入力 | 返るもの | 権限・試験 |
| --- | --- | --- | --- |
| GET `/api/operations/security-alerts` | `account_id`必須、`offset`は0以上の整数 | 未解決の項目、集計状態、基準値、総数と表示位置 | owner/admin＋その店の所属。閲覧のみも可。他店・同統括の担当外・指定なしは403 |
| POST `/api/operations/security-alerts/:id/acknowledge` | queryの`account_id`、JSONの`expectedVersion` | 受領状態と新しい版 | 上記の所属＋変更可。閲覧のみ・代理ログインは403。別店IDは404、古い版は409 |
| POST `/api/operations/security-alerts/:id/resolve` | 同上 | 解消状態と新しい版 | 同上。人が原因と対処を確認してから押す |
| GET `/api/ops/security-alerts` | `offset` | 全範囲の未解決項目と集計状態 | 既存の運営マスター判定。通常の店のowner/adminというだけでは通さない |
| POST `/api/ops/security-alerts/:id/acknowledge` | JSONの`expectedVersion` | 受領状態と新しい版 | 運営マスター＋変更可、閲覧のみ・代理ログイン禁止 |
| POST `/api/ops/security-alerts/:id/resolve` | 同上 | 解消状態と新しい版 | 同上 |

`securityMonitorApi.list(accountId?, offset?)`、`acknowledge(id, version, accountId?)`、`resolve(id, version, accountId?)`。accountIdを省略するのは運営コンソールだけ。サーバーの門番が最終判断する。画面は店の未選択を省略へ勝手に変換しない。

成功は `{ success: true, data: ... }`。一覧のdataは`items / monitor / thresholds / configurationValid / windowMinutes / limit / offset / total`。1頁200件。`offset + items.length < total`なら次の頁がある。操作後は一覧を読み直す。503は未適用の表・取得失敗などで、0件の正常応答へ変換しない。

項目の値：

- `id / ruleKey / summary / count / threshold / status / version`。summaryは固定の日本語。statusは`open / acknowledged / resolved`。受領と解消は別。
- `firstDetectedAt / lastDetectedAt / reviewedAt`はUTC ISO。画面は日本時間の明示付きで表示する。人数と操作回数を同じものとして表示しない。
- `notification`は`sent / pending / unconfigured`。失敗はpendingで再送待ち。sentはSlack APIが受付成功した意味で、人が読んだ保証ではない。
- 運営APIだけは`scope: { tenantId, lineAccountId }`を返し、権限のある担当が対象の監査へたどれるようにする。店APIとSlackにはこのscopeを出さない。
- `monitor.status`は`unknown / failed / stale / running`。runningは直近15分に完了記録がある意味。`lastStartedAt / lastCompletedAt`がnullなら「未取得」。failed・stale・unknownを緑の「異常なし」にしない。
- 一覧が空でも「監視対象の記録で警告なし」とする。監査対象外のAPIや位置情報まで安全と書かない。設定不正は`configurationValid: false`で知らせる。

店のAPIは店ID＋統括IDで絞る。店のない認証失敗、スタッフ追加・権限変更、隠された代理ログインなどは運営APIで扱う。本人不明のログインを店へ推測配賦しない。店側に出る件数だけで、統括全体の安全を判断しない。

## 検証専用の手動実行（10-16追加）

`POST /api/ops/security-alerts/run-once`。入力なし。`securityMonitorApi.runOnce()`を使用し、返却は`{ success: true, data: { monitor: SecurityMonitorStatus } }`。既存の管理認証・CSRF・運営の変更権限を要求し、代理ログインは403。`DEPLOY_ENV`が正確に`staging`のときだけ利用可能で、本番・未指定・未知の環境は404。5分のleaseを無視する強制実行ではない。完了日時を読み、同じ窓の再実行を成功した再集計と数えない。失敗・未適用は503。

安全監視だけを実行し、配信・予約などの定期処理へは渡さない。試験用の監査を作るAPIではない。[検証手順と費用](DETECTION.md#5分ごとの処理の重さと費用b-34310月16日追加)。通常の管理画面に本番用の実行ボタンを追加する契約ではない。

## 初期の基準と調整

すべて直近15分、基準**以上**で通知。`SECURITY_MONITOR_THRESHOLDS` のJSONで項目ごとに変更できる。未指定は下表、不正・未知の項目・0・負数・小数・上限超えは全体を初期値へ戻して設定不正を返す。上限は10,000,000。変更自体はオーナーの運用作業。

| 項目名 | 初期値 | 数える記録 |
| --- | ---: | --- |
| login_failures | 20 | 認証監査の失敗 |
| api_mutations | 1000 | 共通監査が記録する`api.*`の変更操作。HTTP全数ではない |
| export_requests | 10 | 成功した書き出し・資料取得の記録 |
| export_records | 10000 | 成功出力の監査にある既知の件数の合計。未知は推定しない |
| permission_changes | 1 | スタッフ更新・権限更新の成功。氏名変更等も含む保守的な検出 |
| admin_additions | 1 | スタッフ追加・招待の成功。管理者候補として人が役割を確認 |
| key_rotations | 1 | API鍵の更新/失効、記録対象のMFA作り直し/方針変更 |
| impersonation | 1 | 運営監査の代理ログイン開始・書込許可・個人情報の開示 |
| night_activity | 100 | 日本時間0時以上6時未満の業務監査 |

位置の変化、Webhookの署名失敗、全HTTPの急増、Google/Cloudflare等の鍵操作、GitHubの秘密検出は今回の自動集計外。[人が確認する場所](DETECTION.md)を併用する。

## 保存・通知・反映の条件

既存の5分ごとの定期運用確認から集計する。店が0件でも監視は動く。実行のleaseで同時起動をまとめ、集計失敗は固定のエラー種別と最終完了時刻で残す。認証情報の値・原文・IP・自由文・URLを新しい表へ複写しない。

691の検索用UTC列と索引で、最初から正確な直近15分だけを読む。元の日時は変更せず、既存行を補完し、追加・日時変更の自動処理で検索用の値を保つ。platform_audit_logsの元のcreated_at索引は405に存在する。通常のCron時刻の小さなずれで次の5分窓を飛ばさない。既存監査の量に応じて、691の索引作成の時間と配備後のD1使用量をオーナーが確認する。

`security_monitor_state`は最終完了と実行lease、`security_alerts`は統括/店・固定項目・件数・時刻・状態・Slack再送の状態を持つ。同じ未解決は1件へまとめる。静かになっても自動解消しない。人が解消した後、新しい操作が基準以上なら再発として再通知する。古い15分窓の同じ操作だけでは再発させない。受領/解消は既存監査へ記録する。

Slackへ出すのは固定名・整数の件数・サーバーで作った事故ID・日時のみ。通知先は既存`SLACK_ERROR_CHANNEL_ID`、資格情報は既存`SLACK_BOT_TOKEN`。5分の送信lease、最大30件/回、10秒の通信上限で再試行する。APIの`ok:false`も失敗。未設定は成功にしない。再送の同一IDで重複を抑え、再発では別IDにする。

691は実行していない。オーナー/司令塔が最新開発枝と公開PRの採番を再確認→クリーン・バックアップ・dry-run→別途承認されたDB適用→コード配備→検証の架空記録で通知と拒否を確認、の順で反映する。ほかの担当の未適用変更を一緒に適用しない。未適用のまま配備すると安全監視APIは503、定期監視は固定の失敗ログになる。既存の配信定期処理は失敗を隔離して続ける。

「わな」の値は[検証だけの案](DETECTION.md#わなの値の案検証だけ)。実装・配備済みの検出には数えない。

## 試験と引き継ぎ

`services/security-monitor.test.ts`は実SQLiteでしきい値、時差、出力量、機密情報除外、再送・同時実行・再発・監視故障・定期確認からの接続を確認。`routes/security-alerts.test.ts`は実SQLの店/統括・担当の境界、運営権限、閲覧のみ、代理ログイン、古い版、未適用を確認。終了値と故障対照の最終結果は[作業記録](../document-archives.md#s05)に記す。

PR番号は司令塔の採番後に反映履歴へ追加する。運用者向けの文案：`不審な操作の増加を知らせる仕組みと、情報漏えいの疑いに対応する手順を用意した`。番号の先取り、push・PR作成はしない。
