# V6 32 運用状態 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 32-x、現行 `/emergency`・`/health`、ヘルス・配信停止・更新履歴、Lステップの上限警告・通知・障害情報

## 0. 結論と採点

V6は、LINE接続、配信上限、外部連携、Webhook、配信遅延、友だち変化を一画面で常時確認し、異常時に配信系を選んで止め、停止・復旧・リリース履歴を残す。Lステップの上限警告やログイン履歴を超えて、運用事故を防ぐ独自機能になり得る。

しかし現行の「5分ごと」は画面を開いているブラウザ内のtimerで、結果はサーバへ保存されない。緊急停止の状態・対象・履歴もlocalStorageであり、別端末には伝わらず、サーバ側の共通kill switchではない。画面が各機能を順番に更新しているだけなので、途中失敗、実行中job、別worker、次のenqueueを確実には止められない。現行のまま本番へ出すことは不可。V6は維持し、サーバ側の監視・停止基盤を新設する。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 99 | 100 | 異常発見→停止→復旧→履歴が一続き |
| Lステップ対抗力 | 100 | 100 | 専用の運用管制として明確に上回る |
| 現行実装完成度 | 38 | 98 | 表示はあるが監視・停止が端末内 |
| データ安全性 | 21 | 100 | localStorage停止状態・非原子的更新は本番不可 |
| 実現可能性 | 96 | 99 | server cron、D1、Queue、dispatch gateで実現可能 |
| 要件確定度 | 98 | 100 | 停止対象と再開原則を固定できる |

不可能なのは、LINEへ送信済みのメッセージ取消、外部サービスで処理済みの要求取消、すでに開始したnetwork requestの完全停止、取得できないLINE内部障害の断定である。これらは除外し、「停止を受理した後に開始する自動送信を止める」と定義する。

## 1. 監査範囲と証拠制限

### 1-1. V6実Node

| Node ID | 画面 |
|---|---|
| `UgonK` | ★ V6 32-1 運用状態・健全性チェック |
| `b3HfZ` | ★ V6 32-1-A 緊急コントロール |
| `UhC2O` | ★ V6 32-1-B 更新履歴 |
| `U0BwS` | ★ V6 32-1-C 緊急停止の最終確認 |

健全性画面は1920×1080、ほか3画面は1920×1136。Pencilからテキスト、構造、clip検査を取得した。

画像出力はノイズ化しており、ピクセル一致の証拠には使えない。clip検査では閉じた共通メニュー、表の未表示行、補助バッジ等が検出された。画像復旧後に同状態・同幅で確認する。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

### 1-2. 現行資産

- `account_health_logs`: LINEアカウント、error code/count、risk level
- `/api/health`: Worker起動だけを見るpublic liveness
- `/api/accounts/:id/health`: 保存済みLINE health log
- ダッシュボードの配信数・友だち日次値
- Webhook設定と連続失敗
- 配信・シナリオ・リマインダ・自動化の個別更新API
- release logをビルド時JSONへ固定する仕組み
- self-update側の更新履歴API
- typed confirmation UI

残すべきものはrelease log、個別機能の停止状態、表示UI。置き換えるべきものはbrowser監視、localStorage停止・履歴、クライアントからの逐次停止、公開envの管理keyで読む更新履歴である。

## 2. Lステップとの差

Lステップは月間配信上限前の警告、サービス通知、ログイン履歴、契約者向け障害情報を提供している。根拠は公式の[用語集・送信数警告](https://linestep.jp/?p=15088)、[通知機能](https://linestep.jp/2025/06/23/lstep-notification/)、[セキュリティチェックシート](https://linestep.jp/lp/01/security_pdf/security_METI20251216.pdf)。

V6は次で上回る。

- LINE・quota・API・Webhook・job遅延・友だち変化の統合監視
- 5分間隔のserver-side check
- アカウント・機能別kill switch
- typed confirmationと理由必須
- 停止後の自動送信skip方針
- 復旧previewとdrift検査
- 停止、復旧、deployment、release内容の追記履歴

## 3. この機能で達成すること

運用者が、異常を早く見つけ、誤送信が起きる前に自動処理を止め、安全に原因確認・復旧できるようにする。

1. サーバが5分ごとに全checkを実行
2. 状態と証拠を保存
3. warning/dangerを運用者へ通知
4. 運用者が対象と影響を確認
5. server-side kill switchを先に有効化
6. queued/scheduled対象を整理
7. 停止後の状態を再確認
8. 原因修正後、driftを確認して復旧
9. 全過程を消せない履歴へ残す

## 4. 監視の原則

- monitoringは管理画面を開いていなくても動く
- check実行と結果をserverで保存
- `normal`、`warning`、`danger`、`unknown`、`stale`を分ける
- 取得失敗をnormalにしない
- 数値、閾値、観測時間、データ元を表示
- 1回の瞬間失敗と継続障害を分ける
- account別と全体を分ける
- maintenance中は判定を抑制しても記録は続ける
- alert dedupe、ack、resolvedを持つ

## 5. check項目

### 5-1. LINE接続

- active LINEアカウントごとにcredential・profile/quota endpointを確認
- 最終成功、連続失敗、HTTP/LINE error code
- webhook受信の最終時刻
- token期限・権限不足・429を区別
- 1回失敗はwarning、5分以上継続または認証失敗はdangerを既定

LINE内部全体の障害を断定せず、「このアカウントからLINE APIへ接続できない」と表示する。

### 5-2. 月間配信数

- Harness側limit/used
- LINE公式アカウント側limit/used
- 実際に送れる残数は小さい方
- 80% warning、95% dangerを既定。設定31で変更可能
- 予定済み配信の見込み通数を加えたforecast
- リセット日時とtimezone

LステップもLINE側通数と両方に制約されるため、片側だけ見て「余裕あり」としない。

### 5-3. API・外部連携

- Worker livenessだけでなくD1、KV、R2、Queueのread/write canary
- EC、広告、Google、Slack等の最終成功と受信件数
- 0件が正常な接続は基準値と曜日を考慮
- expected trafficがあるのに0件のときwarning
- response time、error rate、circuit state
- secret/token期限

public `/api/health` はlivenessとして残し、dependency healthとは分離する。

### 5-4. Webhook

- active接続数
- secret・署名・版
- 直近5分/1時間の成功率
- oldest retry、dead letter
- inbound署名失敗・rate limit
- outbound連続失敗・p95応答時間

機能26の配送台帳を正本にする。

### 5-5. 配信処理

- scheduled件数と次の時刻
- queued、sending、retrying、dead letter
- `now - scheduled_at` の最古遅延
- 10分warning、30分dangerを既定
- Queue consumer heartbeat
- reservation lock、stuck job
- quota不足、LINE 429、credential errorを理由別表示

予約件数だけでnormalにしない。

### 5-6. 友だち変化

- account別の追加、block、純増
- 直近同曜日・過去28日のbaseline
- 母数と絶対人数の両方
- 1日5%以上減をwarning既定。ただし小規模は最低人数閾値を併用
- webhook欠損と本当の減少を区別
- 未来日・時刻ずれ・重複eventを検出

現行のように値が取れたら常にnormalにはしない。

## 6. check runと状態

### 6-1. 実行

- Cron Triggerで5分ごと
- account別にfan-outし、1check失敗が他を止めない
- 手動実行も同じserver jobを起動
- 同じ5分窓の重複runを冪等排除
- check timeoutを個別設定
- run完了時に総合状態を集計

### 6-2. stale

- `last_checked_at`が2周期を超えたらstale
- staleはnormalより優先して表示
- monitoring job自体のheartbeatを別checkにする
- 画面のclient clockで判定しない

### 6-3. alert

```text
open → acknowledged → resolved
             └→ reopened
```

- warning/danger発生で1件作る
- 同じ原因はまとめ、毎5分通知しない
- severity上昇時は再通知
- acknowledged actorとメモ
- resolved時刻と自動/手動
- LINE、email、画面通知。機能24の運用者通知を使う

## 7. 緊急停止の意味

停止対象をcapabilityとして定義する。

- `broadcast_dispatch`
- `scenario_dispatch`
- `reminder_dispatch`
- `automation_actions`。必要ならmessage actionだけ選択
- `auto_reply_dispatch`
- `webhook_outgoing`
- `ad_postback`

V6既定は予約一斉、シナリオ、リマインダを選択し、自動処理は選ばない。受信箱の手動返信、予約受付は止めない。別途選ばない限りWebhook・広告postbackも止めない。

「一斉配信を下書きに戻す」こととkill switchは別処理。最初にkill switchをserverで有効化し、その後にscheduled jobをcancel/holdする。

## 8. 停止実行

1. 権限・step-up MFAを確認
2. account、capability、理由、影響数をserverで再計算
3. typed `停止` とexpected versionを検証
4. 1トランザクションでincidentとcontrol stateを作成
5. dispatchersが次requestから停止を認識
6. queued/scheduled jobをhold/skipへ移行
7. in-flightと既送信を数える
8. 対象別結果を保存
9. 独立した通知経路で運用者へ通知
10. stop verification checkを実行

停止APIは1つで行い、browserから各機能の更新APIを何十件も呼ばない。処理途中に画面を閉じても続く。

### 8-1. dispatch gate

全自動送信は不可逆処理の直前にserver controlを確認する。

```text
job取得
→ account/capabilityのcontrolを確認
→ stoppedなら副作用を起こさずheld/skipped
→ runningならidempotencyを確保
→ LINE/外部へ送信
```

enqueue時だけの確認では不十分。停止直前にQueueへ入ったjobも止める。

### 8-2. できない停止

- LINEへ送信済み
- 外部requestが相手で受理済み
- network request送信後で応答待ち
- 手動返信を許可した場合の人の操作

最終確認に「停止前にすでに送信開始したN件は止められない」と実数を表示する。

## 9. 停止中

- 全端末に同じ停止状態を表示
- incident ID、開始、actor、理由、対象account/capability
- held、skipped、in-flight、failed件数
- 監視checkは続ける
- 新規作成・編集は許可するが、公開・本送信時に停止中と明示
- 停止を回避する別API経路を作らない
- emergency ownerが不在でも通常管理者が許可されていれば操作可能

localStorageは表示cacheにも正本にも使わない。

## 10. 復旧

1. 原因とcheck結果を表示
2. 停止前snapshotと現在定義を比較
3. 削除・編集・権限変更・期限切れをdriftとして表示
4. 再開対象を選ぶ
5. typed `復旧` とstep-up MFA
6. controlをrunningへ変更
7. held jobを方針に従い処理
8. verification check
9. incidentをresolved

停止中に期限を過ぎた配信は自動catch-upしない。`skipped_due_to_emergency`として残し、必要なら新しい配信として再確認する。シナリオ・リマインダも過去時刻分は遡って送らない。

停止前にactiveだったものだけ再開し、停止中に人が意図的に停止したものを勝手に有効化しない。各定義のversionを比較する。

## 11. 更新履歴

### 11-1. 緊急操作

- incident ID
- stop/restore時刻、actor、場所・端末概算
- account/capability
- 理由、補足
- 影響予測と実績
- succeeded/partial/failed
- in-flight、held、skipped
- restore actor、drift、所要時間
- 関連alert・trace

server DBへ追記し、通常管理者は削除不可。localStorage100件制限を廃止する。

### 11-2. システム更新

- deployment ID、環境、from/to commit・version
- 開始、完了、結果
- migration、rollback可否、停止時間
- PR、release log
- deploy actor/automation
- smoke check結果

画面から`NEXT_PUBLIC_ADMIN_API_KEY`を送らない。認証済みserver APIがupdate serviceから署名済みeventを受け、正規DBへ保存する。

### 11-3. 変更内容

現行のビルド同梱release logを正本表示として維持する。

- 追加・変更・修正
- 運用者に分かる文言
- 担当、PR、JST日時
- unreleasedは管理者だけ
- 実行中codeと一致するversionだけ「いまの版」

## 12. データ要件

- `health_check_definitions`
- `health_check_runs`
- `health_check_results`
- `operation_alerts`
- `operation_incidents`
- `operation_controls`
- `operation_control_snapshots`
- `operation_target_results`
- `deployment_events`
- `release_versions`

controlはaccount＋capabilityでuniqueな現在値を持ち、変更履歴は別の追記台帳にする。server時刻はUTC、表示はJST。理由・actor・versionを必須にする。

## 13. API要件

| API | 用途 |
|---|---|
| `GET /api/operations/health` | 最新checkとstaleness |
| `POST /api/operations/health/runs` | 手動server check |
| `GET /api/operations/alerts` | open/ack/resolved |
| `POST /api/operations/alerts/:id/ack` | 確認済み |
| `GET /api/operations/control/preview` | 最新影響数 |
| `POST /api/operations/incidents` | 原子的な緊急停止 |
| `GET /api/operations/incidents/:id` | 結果・停止状態 |
| `POST /api/operations/incidents/:id/restore-preview` | drift確認 |
| `POST /api/operations/incidents/:id/restore` | 安全な復旧 |
| `GET /api/operations/history` | 緊急・deployment履歴 |
| `POST /api/internal/deployments/events` | 署名済み更新event |

停止・復旧は冪等キー、expected control version、typed confirmation、step-up tokenを必須にする。

## 14. 権限と通知

- health閲覧
- alert確認
- account単位の停止
- 全account停止
- capability別停止
- 復旧
- 更新履歴閲覧
- CSV出力

停止・復旧は機能30の重要操作permissionとMFAを要求する。全account停止はowner/adminの専用permission。実行後通知は停止対象と独立したQueue・providerを使用し、LINE失敗時もemail/画面へ残す。通知失敗を停止失敗にはしないが、結果へ表示する。

## 15. 状態

- health: normal、warning、danger、unknown、stale
- alert: open、acknowledged、resolved、reopened
- incident: preparing、stopping、stopped、partial、restoring、resolved、failed
- target: pending、blocked、held、skipped、in_flight、completed、failed
- deployment: queued、deploying、verifying、succeeded、failed、rolled_back
- 読込、空、エラー、権限不足、競合

partial停止は「停止中」と表示し、失敗対象を赤で残す。通常運用とは表示しない。

## 16. 移行

1. account_health_logsを旧LINE check結果として保持
2. 現行6項目をcheck definitionへ登録
3. browser timerをserver Cronへ移行
4. localStorage snapshot/historyは正本移行しない。利用者へ「この端末だけの参考履歴」として必要なら1回export
5. すべてのdispatcherにcontrol gateを追加
6. 現行個別停止APIをincident service内部から呼ぶ互換adapterにする
7. release log JSONを維持
8. update serviceの管理keyをbrowserから除去
9. stagingでstop前後の送信数を比較
10. 本番切替時は停止なし・control runningを確認

## 17. 実現しない・除外するもの

- 送信済みLINEの取消
- 外部で受理済み処理の取消
- LINE全体障害の断定
- client timerだけの監視
- localStorageの停止正本・履歴
- browserからの逐次停止
- 復旧時の過去配信catch-up
- 停止中に人が止めた定義の自動再開
- 取得失敗をnormal表示
- 公開envの管理secret
- 通常管理者による履歴削除
- 自動rollback。rollback手順が検証済みのreleaseだけ別工程で許可

## 18. 完了条件

- 管理画面を閉じても5分checkが継続する
- 6項目の時刻、閾値、証拠、staleがserver保存される
- dependency失敗・取得失敗をnormalにしない
- warning/dangerが重複せず通知される
- 停止APIがcontrol flagを先に原子的に設定する
- 全dispatcherが不可逆処理直前にcontrolを確認する
- 停止受理後に新しい自動LINE送信が0件
- in-flight/既送信件数を表示できる
- 別端末・再ログイン後も同じ停止状態と履歴が見える
- 部分失敗を通常運用と表示しない
- 復旧previewでversion driftと期限切れを検出する
- 期限切れ配信を自動送信しない
- actor、理由、対象、結果、通知結果が追記履歴に残る
- update履歴取得でbrowserに管理secretを置かない
- 1440px・1920pxで横スクロールがない
- V6実Node、設計画像、同幅実装画像を横に並べて確認する
- `準備中`のボタンがない

## 19. 実装順

1. 全自動dispatch経路の棚卸し
2. operation_controlsと全dispatcher gate
3. incident stop/restore APIと追記履歴
4. server Cron checkと結果保存
5. alert・運用者通知
6. Queueのheld/skipped/in-flight可視化
7. deployment eventとrelease log統合
8. V6 health/control/history/confirm画面
9. localStorage・公開管理keyを撤去
10. stagingで誤配信防止E2E、権限、画像比較

## 20. 最終判断

V6 32は設計として非常に良く、Lステップ越えの独自機能にできる。ただし現行は本番運用の停止装置ではなく、ブラウザから複数設定を更新する補助画面である。server-side kill switch、dispatcher gate、server Cron、追記履歴へ置き換えることをP0とする。この条件を満たすまで「緊急停止」の本番動作を名乗らない。
