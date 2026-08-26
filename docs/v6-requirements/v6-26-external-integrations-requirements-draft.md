# V6 26 外部連携 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 26-x、現行 `/webhooks`・`/webhooks/new`、Webhook DB/API、イベントバス、LステップのWebhook・API連携

## 0. 結論と採点

V6は「こちらから送る」「こちらで受け取る」「やり取りの記録」を利用者の言葉で分離し、LステップのWebhook転送とAPI連携を一つの運用画面で扱える。方向性は良く、要件定義へ進める。

現行にも送受信Webhook、HTTPS制限、HMAC-SHA256、32文字以上のsecret、短時間retry、連続失敗、内部event busがある。ただしWebhookが組織・LINEアカウントに紐づかず全体共通、secretは平文、配送1件ごとの台帳がなく、手動retryやV6の受信mapping・アクションは未実装である。さらにオートメーションの `send_webhook` はこの安全な経路を通らず、署名・retry・記録なしで直接fetchする。V6を載せる前に全外部通信を一つの配送基盤へ集約する。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 98 | 100 | 方向、失敗、再試行を運用者が理解できる |
| Lステップ対抗力 | 99 | 100 | 往復連携、mapping、台帳で同等以上 |
| 現行実装完成度 | 55 | 98 | 基本送受信はあるが運用・履歴・scopeが不足 |
| データ安全性 | 36 | 100 | 全体共通、平文secret、SSRF、replayが重大 |
| 実現可能性 | 97 | 99 | Queue・R2/D1・既存event busを拡張できる |
| 要件確定度 | 97 | 99 | 接続先テンプレートを限定しなくても中核は固定可能 |

不可能な画面はない。除外するのは、相手側が保証しないexactly-once、LINE既読を外部イベントとして送ること、送信済み要求の取消、秘密値の再表示、任意URLへの無制限送信、無限retry、署名なし受信、名前だけによる友だち自動照合、外部API仕様を推測した自動mappingである。

## 1. 監査範囲と証拠制限

### 1-1. V6実Node

| Node ID | 画面 |
|---|---|
| `k3WxrO` | ★ V6 26-1 外部連携 |
| `M0Gb7` | ★ V6 26-1-A こちらで受け取る |
| `KNG00` | ★ V6 26-1-B やり取りの記録 |
| `f8SBSh` | ★ V6 26-1-C 外部連携・一覧の状態 |

3画面は1920×1080、受信画面は1920×1136。Pencilからテキスト、構造、clip検査を取得した。

画像出力はノイズ化しておりピクセル一致の証拠には使えない。clip検査では閉じた共通メニュー、表の未表示行、ページ送りなどが検出された。画像復旧後に同じ状態・横幅で確認する。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

### 1-2. 現行資産

- `incoming_webhooks`: 名前、source type、secret、active
- `outgoing_webhooks`: 名前、URL、event types、secret、active、短時間retry、連続失敗
- 受信HMAC-SHA256検証とconstant-time比較
- 送信HMAC-SHA256署名
- HTTPSだけを許可
- secretなし・短い既存Webhookを停止する移行
- 内部event busから複数送信先へ配送
- 受信payloadを内部eventへ変換
- scoring、automation、rich menuとの接続

新規構築ではない。しかし現在のデータにはorganization/LINE accountがなく、接続設定と配送がテナント境界を持たないため、最初に分離する。

## 2. Lステップとの差

Lステップは、友だち追加・メッセージ受信・ボタンタップなどを外部へ転送し、API連携で友だち、タグ、対応マーク、共通情報、メディア、テンプレート等の取得・更新やアクション実行を提供している。根拠はLステップ公式の[Webhook転送](https://linestep.jp/lp/01/features35.html)、[Webhook＋API連携](https://linestep.jp/lp/01/features40.html)、[API連携解説](https://linestep.jp/2025/12/08/lstep_api/)。

V6は次で上回る。

- 送信と受信を同一画面で運用
- 接続ごとの成功率、失敗集中、応答時間
- 受信payloadの項目発見とmapping
- 友だち照合の結果と「何もしなかった」理由
- 1件・一括retry
- secretを一度だけ表示し安全にrotate
- 共通アクション25へ接続

ただしLステップの公開API相当をV6の受信Webhookだけで代用しない。Webhookはeventを受ける口、公開APIは外部システムが明示操作する口として別に設計する。

## 3. この機能で達成すること

運用者が、内部のできごとを外部へ安全に送り、外部のできごとを内部へ安全に取り込み、失敗を追跡・復旧できるようにする。

1. 送信または受信の接続を作る
2. 認証、event、schema、mapping、アクションを決める
3. テストpayloadで確認する
4. 公開版として有効化する
5. 全配送を台帳で追う
6. 一時失敗をQueueでretryする
7. 恒久失敗は理由を示し、修正後に選択retryする
8. secretを安全にrotateし、旧版を期限付きで止める

## 4. 概念の分離

| 概念 | 役割 |
|---|---|
| 内部イベント | Harness内で起きた事実。変更しないevent IDを持つ |
| 送信接続 | eventを外部形式へ変換し、署名して送る |
| 受信口 | 外部eventを認証・検証し、内部eventへ変換する |
| 公開API token | 外部からHarnessの明示操作APIを呼ぶ認証 |
| 配送台帳 | 1 event × 1 connectionの実行・retry・結果 |
| 共通アクション | 受信後に動かすtag、message、field等 |

フォーム専用Webhook、広告postback、Stripe、EC-CUBE、Slackなどの個別実装も、最終的には同じ配送台帳・secret・監査を共有する。

## 5. テナント境界

すべての接続・event・配送に次を必須にする。

- organization_id
- line_account_id。複数対象なら明示したscope
- created_by、updated_by
- connection_id、version_id
- 権限と利用中の機能設定

一覧・詳細・receive・retry・停止のすべてで一致を検証する。現在のglobalなincoming/outgoing行は、利用実態を棚卸しし、所有先不明なら停止したまま管理者確認へ回す。自動的に全アカウントへ複製しない。

## 6. こちらから送る

### 6-1. 設定

- 名前、説明、担当
- 送信先HTTPS URL
- 認証方式: HMACを既定、Bearer/OAuth2はconnector対応時のみ
- event registryから1つ以上選択
- 条件
- payload schema version
- 送る項目とmask
- timeout、retry policy
- rate limit
- pause/circuit breaker
- 下書き、テスト、公開

event typeを自由入力させない。内部event registryのIDとschemaを選び、存在しないeventは公開できない。

### 6-2. payload

共通envelope:

```json
{
  "id": "evt_...",
  "type": "booking.confirmed.v1",
  "occurred_at": "2026-08-25T02:42:00Z",
  "account_id": "...",
  "data": {},
  "attempt": 1
}
```

- event IDはretryでも同じ
- payload schemaはversion固定
- 送信時刻と発生時刻を分ける
- 個人情報項目は明示選択。既定は最小
- secret、access token、内部memoを含めない
- 公開版を後編集で変えない

### 6-3. 署名

- `X-Harness-Event-Id`
- `X-Harness-Timestamp`
- `X-Harness-Signature: v1=<hex>`
- 署名対象はtimestamp、event ID、raw body
- 相手は時刻許容幅とevent IDでreplayを拒否可能
- secretは最低256bitランダム
- current/previousの2本を短期併用して無停止rotate

現行のbodyだけの署名はreplayを防げないため更新する。

### 6-4. 配送

- business transactionではoutboxだけ作る
- Queue consumerが送信
- timeout既定10秒、最大30秒
- 2xxだけ成功
- 408、409の明示再試行可、425、429、5xx、network errorをretry
- 4xxは原則恒久失敗
- `Retry-After`を尊重
- exponential backoff＋jitter
- 既定最大8回・24時間、接続ごと上限
- retryはWorker内sleepで待たない
- 連続失敗でcircuit open、運用者通知

at-least-once配送であり、相手にもevent IDの冪等処理を求める。exactly-onceとは表示しない。

## 7. こちらで受け取る

### 7-1. 受信口

- 推測困難なendpoint ID
- secretまたは公開鍵
- 許可method、content type
- 最大body。既定256KB、上限1MB
- rate limit
- optional IP allowlist
- schema
- event type mapping
- active/paused/expired

URLの推測困難性だけを認証にしない。secretは必須で、署名timestamp、nonce/event ID、replay windowを検証する。

### 7-2. 入力検証

1. endpointとactiveを確認
2. body size、content type、rate limit
3. raw bodyで署名検証
4. timestampとreplay確認
5. JSON parse
6. schema validation
7. inbound eventを台帳に1回記録
8. 即時202を返し、mapping・actionはQueueで処理

parse・schema・署名失敗も個人情報を残しすぎない形で台帳に記録する。

### 7-3. 人の照合

推奨順位:

1. Harnessのfriend ID/外部ID
2. 連携専用のexternal customer ID
3. 検証済みメール完全一致
4. 検証済み電話番号の正規化完全一致

名前だけの照合は除外する。複数一致は自動実行せず`ambiguous`、0件は`not_found`。設定で「何もしない」「未結合箱へ入れる」「新規候補を作り承認待ち」を選ぶ。勝手に友だちを新規作成しない。

### 7-4. mapping

- sample payloadからkeyを発見
- JSONPathを明示選択
- 型: 文字列、数、真偽、日時、配列
- 必須、default、変換、timezone
- previewで入力→内部event→actionを確認
- payload schemaが変わったら新version
- 未知項目は保存するか破棄するかを明示。既定破棄

V6の「最近届いたもの」をschema作成に使えるが、実顧客値はmaskし、保持期限を短くする。

### 7-5. 届いたらすること

共通アクション25を版固定で参照する。

- tag追加・削除
- friend field更新・加算・減算
- 対応マーク
- template送信
- scenario開始・停止
- reminder登録
- conversion
- mileage/score
- operator notification
- 別の送信Webhook

同じinbound event IDでactionを二重実行しない。部分成功はaction別台帳を持ち、失敗分だけ再開する。

## 8. やり取りの記録

### 8-1. 1配送ごとに持つもの

- direction
- connection/version
- event ID、event type
- source event ID
- account、friend/subject
- queued、started、finished
- attempt番号
- request size、payload schema
- HTTP status、response time
- response headerの安全な一部
- success、retrying、failed、skipped、dead_letter
- error code、運用者向け原因
- 次回retry時刻
- trace ID

payload/response本文は既定で保存しない。debug modeを期限付きで有効にした場合のみ、暗号化・mask・短期保持する。

### 8-2. 詳細

- 人向け要約
- 送受信項目名とmask値
- request/response metadata
- attempt timeline
- mapping結果
- action結果
- 次に取る操作

V6のメール、氏名、金額が一覧に直接出る設計は権限・mask対象にする。

### 8-3. retry

- 自動retry予定のものは二重に手動実行しない
- 恒久失敗は設定修正後に選択retry
- inbound replayは同じevent IDで失敗actionだけ再開
- outbound retryは同じevent IDとpayload version
- 一括retry前に件数、対象、外部副作用を確認
- 成功済みを通常操作でretryしない。管理者の明示再送だけ別eventとして実行

## 9. test

- 送信: schemaに沿う架空データを送る
- 実顧客データを既定で使わない
- `test=true`、専用event IDを付ける
- 受信: sample JSONを検証し、mappingとaction previewまで。既定ではaction実行しない
- 本番実行するテストは二段階確認と専用権限
- 結果を台帳へ`test`として分離

## 10. secret・token

- secretはサーバ側生成を既定
- 作成時だけ表示
- D1にはenvelope encryptionした値を保存
- 鍵はKMS/Secrets側で管理
- list/detail APIは`hasSecret`、末尾、作成日だけ
- rotateは新旧併用期間を持つ
- copy、rotate、revokeを監査
- URL queryやpayloadへtokenを入れない
- OAuth refresh tokenも同じvaultへ保存
- log、error、Slackへ秘密値を出さない

現行secret平文を移行し、暗号化確認後に平文列を廃止する。

## 11. SSRFと送信先安全性

HTTPSだけでは足りない。

- localhost、loopback、link-local、private、multicast、metadata IPを拒否
- DNS解決前後に検証しrebindingを防ぐ
- redirectは既定禁止。許可時も各hopを再検査
- portは443を既定。例外は管理者承認
- URL username/passwordを拒否
- queryのsecretらしい値を警告・拒否
- TLS検証を無効化しない
- 接続先ごとに送信量・帯域・並列数を制限

オートメーションの直接`fetch(action.params.url)`を廃止し、登録済みconnection IDだけを共通配送へ渡す。

## 12. 公開API

LステップのAPI連携と競合するため、Webhookとは別に公開APIを持つ。

- scoped access token
- tokenごとのorganization、LINE account、操作scope
- 一度だけ表示、hash/encrypted storage
- rate limit、quota
- idempotency key
- OpenAPIとcurl例
- token使用履歴
- rotate/revoke
- friend、tag、field、support mark、common info、media、template、actionの許可API
- 変更APIはexpected versionと監査

初版では全内部APIを公開しない。安定したschemaと権限がある操作だけ段階的に追加する。

## 13. 画面とURL

| 画面 | URL | 役割 |
|---|---|---|
| 送信一覧 | `/integrations/outgoing` | 接続、成功率、停止、test |
| 送信作成 | `/integrations/outgoing/new` | event、payload、認証、retry |
| 受信一覧 | `/integrations/incoming` | 受信口、回数、状態 |
| 受信詳細 | `/integrations/incoming/:id` | endpoint、schema、mapping、action |
| 記録 | `/integrations/deliveries` | direction、result、retry |
| API token | `/integrations/api-tokens` | scope、rotate、履歴 |
| 見本 | `/integrations/templates` | Slack、GAS、Make等の初期値 |

既存 `/webhooks` は互換転送する。

## 14. 状態

- 下書き、テスト済み、active、paused、circuit_open、revoked
- 読込、空、条件0件、エラー、権限不足
- queued、sending、success、retrying、permanent_failed、dead_letter、skipped
- inbound: accepted、invalid_signature、invalid_schema、duplicate、not_found、ambiguous、processed、partial、failed
- secret rotation required
- schema changed
- destination unsafe

「返事なし」と「相手が500」と「受信したが人が見つからない」を同じ失敗にしない。

## 15. データ要件

- `integration_connections`
- `integration_connection_versions`
- `integration_secrets`
- `integration_event_schemas`
- `integration_outbox`
- `integration_deliveries`
- `integration_delivery_attempts`
- `integration_inbound_events`
- `integration_action_runs`
- `integration_api_tokens`
- `integration_rate_counters`

event ID、connection version、idempotency keyにunique制約を置く。大きなdebug payloadは暗号化してR2へ短期保存し、D1は参照・hash・sizeだけ持つ。

## 16. 権限と監査

- 一覧閲覧
- payload詳細閲覧
- 接続作成・編集
- test送信
- 公開・停止
- secret表示・rotate
- retry
- API token発行
- 個人情報payload閲覧

secretとtokenはstep-up MFA必須。作成、公開、停止、rotate、retry、payload閲覧を共通監査30へ記録する。

## 17. 移行

1. incoming/outgoingを棚卸し
2. 所有organization/LINE accountを確定
3. 不明なものは停止
4. secretを暗号化し、旧平文のhash照合
5. event_types自由文字列をregistryへ対応。未知値は停止
6. 既存outgoingをversion 1として固定
7. 現行短時間retryはQueue policyへ移行
8. form webhook、automation send_webhook、Slack等の直接fetchを接続IDへ置換
9. 新旧をshadow/testし、件数と結果を照合
10. 二重配送を防いで切替

過去の配送明細は存在しないため捏造しない。連続失敗数と最終失敗だけを「移行前集計」として残す。

## 18. 実現しない・除外するもの

- exactly-once保証
- LINE個人既読event
- 送信済みrequestの取消
- 任意URL・private networkへの送信
- 無限retry
- 署名なし受信
- secretの再表示
- 名前だけの友だち照合
- schemaなしでの自動項目更新
- 成功済み配送の無確認再送
- 外部API仕様の自動推測
- 実顧客データを使う既定test
- 全内部APIの一括公開

## 19. 完了条件

- V6 4画面の主操作が実URLへ遷移する
- 接続・配送がorganization/LINE accountを越境しない
- 送受信のHMAC、timestamp、event ID、replay拒否が通る
- secretが暗号化され、list/detail/logへ出ない
- private/metadata/redirect SSRFテストを拒否
- event発生→outbox→Queue→配送→台帳がE2Eで通る
- 429/5xx/networkをQueueでretryし、4xxを恒久失敗にする
- 同じevent IDで外部副作用を二重実行しない
- inbound schema、mapping、not_found、ambiguousを再現できる
- 部分失敗で失敗actionだけ再開できる
- 一括retryに件数・対象・副作用確認がある
- automation/form等の直接fetchが残らない
- `準備中`のボタンがない
- 1440px・1920pxで横スクロールがない
- V6実Node、設計画像、同幅実装画像を横並び確認する

## 20. 実装順

1. 外部fetch経路と接続の全棚卸し
2. organization/LINE account境界
3. encrypted secret vaultとrotate
4. event registry・schema・版
5. outbox、Queue、delivery/attempt台帳
6. HMAC timestamp/event ID、replay防止、SSRF防止
7. inbound schema、mapping、共通アクション
8. 公開API tokenと初期endpoint
9. V6送信、受信、記録、状態画面
10. 既存移行、二重送信防止、E2E、画像比較

## 21. 最終判断

V6 26は要件定義へ進める。Lステップ越えの設計だが、現行の全体共通Webhook、平文secret、配送台帳なし、オートメーション直fetchはそのまま使えない。接続を組織別にし、外部通信をQueue・署名・台帳へ一本化すれば、V6の成功率、失敗原因、再試行、双方向mappingを安全に実現できる。
