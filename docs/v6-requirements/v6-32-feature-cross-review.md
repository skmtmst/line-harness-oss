# V6 全32機能 横断整合レビュー

更新日: 2026-08-26
対象: 全32要件定義、V6 Pencil、現行DB/API/実行処理

## 0. 結論

32本の要件は実装へ渡せる。ただし、同じ概念を機能ごとに別実装すると、二重送信、数字不一致、権限漏れ、公開後の書換えが再発する。以下の11項目を横断正本とし、機能別要件より優先する。

1. 組織・LINEアカウント境界
2. 認証・権限・項目マスク
3. 定義・版・公開・snapshot
4. event受信・正規化・action実行
5. job・再試行・停止・復旧
6. 配信・通知の共通台帳
7. media原本・派生asset・同意
8. 金額・mile・scoreの追記台帳
9. 分析用read modelと鮮度
10. archive・保持・監査
11. 移行・cutover・rollback

## 1. 正式な所属モデル

```text
organization
└─ line_account
   ├─ operator membership / role / permission
   ├─ friend
   ├─ definitions / versions
   ├─ receipts / events / executions
   └─ domain records
```

- `organization_id`: 契約主体・会社
- `line_account_id`: LINE公式アカウントと業務データの最小境界
- `operator_id`: 管理画面利用者
- `friend_id`: そのLINEアカウント内の友だち
- 同じLINE user IDでも別LINEアカウントのfriendは別record
- APIはURLまたは認証contextからaccountを解決し、bodyのaccount IDを信用しない
- account不明の旧データは推測で割り当てず隔離
- 組織横断表示は権限と明示的scopeがある集計APIだけ

## 2. 正式な版モデル

機能5〜13、16〜19、21、24、25、27〜29で版が必要である。別々の流儀を作らない。

```text
definition ──< immutable version
     │              │
     └ current draft│
                    └ publication ── effective_at / paused_at
                                         │
                                         └ job/action snapshot
```

- draftは編集可能
- published versionは不変
- 「編集」は前版から新しいdraftを作る
- 新版公開後も既存利用先は自動切替しない。利用先ごとに切替確認
- queue済みjob/actionはversion IDとrender snapshotを保持
- 予約済み・待機中への新版適用は対象件数と差分を確認し、migration eventを記録
- deleteではなくarchive。過去実行から参照できる

## 3. eventと実行の正式モデル

18、19、20、23、25、26が別々の「共通イベント台帳」を作ってはいけない。役割を分けて一つにする。

```text
external receipt / internal fact
            ↓ normalize
        domain event
            ↓ match rules
        action execution
            ↓ enqueue
          job attempt
            ↓
 provider result / reconciliation
```

- `external_receipt`: Webhook raw body、署名、受信時刻、provider event ID
- `domain_event`: account、subject、event type、occurred_at、schema version、source reference
- `action_execution`: rule/action version、対象、idempotency key、結果
- `job_attempt`: claim、lease、attempt、next_retry_at、error、provider request ID
- `metric_event`: 分析用read modelへ投影した取得可能な事実
- raw receiptとdomain eventは同一物ではない
- 業務DBの正本を分析eventで置き換えない

## 4. 共通状態名

### 定義

`draft / published / paused / archived`

### 実行

`planned / queued / claimed / succeeded / skipped / retry_wait / permanent_failed / cancelled`

### 外部接続

`connected / degraded / paused / auth_expired / rate_limited / disconnected`

### データ鮮度

`fresh / delayed / stale / unavailable / partial`

### 画面

`loading / empty-create / empty-filter / error / permission_denied / feature_off / conflict`

機能固有状態はこれへ追加する。`failed`一語で一時失敗・恒久失敗・部分失敗を混ぜない。未取得を0にしない。

## 5. 横断矛盾と解決

### 5-1. マイルと行動スコア

17で分離済み。共通`point`モデルに戻さない。

- mileage: 顧客資産、失効・交換・残高・追記台帳
- score: 内部指標、顧客非表示、配信条件・優先度
- URLは`/mileage`配下に統一し、旧`/scoring`はredirect

### 5-2. 流入・コンバージョン・分析・EC

- 18はtouch/traffic/ad delivery
- 19は成果定義とconversion fact
- 20はread modelと分析結果
- 23はEC receipt/normalized commerce event
- 16は19の確定conversionを報酬へ投影

一つの出来事を各機能で複製しない。source referenceとprojectionでつなぐ。

### 5-3. 顧客通知と運用者通知

ユーザー判断どおり双方向を残す。ただし24内で定義を分離する。

- 顧客通知: customer recipient、取引/予約案内、顧客同意とLINE枠
- 運用者通知: operator recipient、対応/障害、勤務・担当・代替channel
- 共通にするのはdelivery ledger、retry、auditだけ
- 片方の定義をもう片方へ変更しない

### 5-4. 機能設定と緊急停止

- 31機能設定: 契約・会社・個人の通常設定
- 32運用状態: 障害時のserver kill switch
- 実行可否は`運用停止 > 契約不可 > 会社OFF > 個人非表示 > 定義停止`の順で判定
- 画面非表示だけでAPI実行を許可しない

### 5-5. テンプレート・共通情報・登録メディア

- 14: account共通値と個別override
- 15: media asset、private original、派生版、利用先
- 11: message/content version。mediaは15を参照
- templateやmessageへ画像URLをcopyして正本化しない
- secret・tokenを14へ置かない

### 5-6. 写真審査と登録メディア

- 22投稿写真は審査前のsubmission asset
- 採用・同意後のpublic derivativeだけ15のmedia assetとしてpromotion可能
- originalはprivateのまま
- 採用と公開は別状態
- AIは人の確認補助に限定

### 5-7. EC連携とNEN配信

- 23だけがEC Webhookを受信・正規化
- 21は23のdomain eventをtriggerとして使う
- 21が独自にEC eventを再受信しない
- 到着実測と予定を分ける
- coupon/point/LINEは各action executionでreconcile

### 5-8. オートメーションと各機能のアクション

25の共通action catalogを、5、7、8、9、16、17、19、21、23、24、27、29が参照する。

- action definition/versionは不変
- 利用先はversion単位で表示
- 新版公開で利用先を自動変更しない
- domain固有処理はadapter。任意JSON実行を許可しない

### 5-9. 予約管理・予約設定・イベント予約

- 28がmenu/resource/calendar/exceptionの定義と版
- 27が個別予約、代理予約、競合、Google同期
- 29がevent capacity、seat、waitlist、promotion deadline
- 通常予約枠とevent定員を同じ在庫recordに無理に統合しない
- 共通にするのはcontact、notification、idempotency、audit、calendar adapter

### 5-10. ダッシュボード・分析・運用状態

- 1は20のaggregateと32のhealthを読む入口
- 1独自のKPI計算を作らない
- cardごとに期間、分母、鮮度、出典を表示
- 障害時に0へ置換しない

### 5-11. 友だちと友だち属性

- 3はfriend identity/profile/current value
- 4はattribute schema、tag/field/mark definition
- schema削除はvalueを物理削除せずarchive
- 値変更はactor/source/reasonのaudit eventを持つ

### 5-12. 配信5機能

5シナリオ、6一斉、7リマインダ、8自動応答、9友だち追加時配信は次を共有する。

- message content version
- audience/condition engine
- delivery ledger
- LINE quota/rate limit
- opt-out/block/feature/kill-switch gate
- test recipient
- click tracking
- skipped/retry/permanent failure

UIとtriggerは分けるが、送信基盤を複製しない。

## 6. API共通規則

- 認証済みoperatorとaccount contextをserverで解決
- permissionはdeny-by-default
- listはcursor pagination。最大件数を固定
- writeは`Idempotency-Key`と`expectedVersion`
- 競合は409、権限不足403、対象なし404、入力不備422
- 非同期処理は202＋job ID。完了を同期応答で装わない
- errorは利用者向けcodeと内部trace IDを分離
- secret/PIIは項目マスク、purpose、download audit
- bulkは全件transactionを装わず、対象ごとの結果を返す
- exportは非同期生成、短期署名URL、件数・条件・actorを監査
- delete endpointは原則archive。物理削除は保持policyのsystem jobだけ

## 7. 共通監査

次を追記で残す。

- actor、role、organization/account
- action、target type/ID
- before/afterの安全な差分
- reason、approval、request/trace ID
- version、idempotency key
- occurred/recorded time、timezone
- external provider reference

secret、本文PII、URL query、画像original等を監査logへ直接書かない。high-risk操作は再認証、必要に応じ二者承認を使う。

## 8. 100点へ近づける共通条件

全機能に次がそろった時だけ98〜100点とする。

- 主タスクを開始・完了できる
- 空、読込、error、権限、失敗、競合がある
- account境界とserver権限testが通る
- 公開版と待機snapshotが再現できる
- external副作用が冪等でreconcileできる
- 取得不能を正直に表示する
- archive・監査・保持がある
- migrationの件数・金額・hashが一致する
- 1440/1920で横scrollがない
- V6実Nodeと同幅画像比較がある
- `準備中`または無効な見せかけbuttonがない

## 9. 残る外部判断

要件を止めないが、実装前に契約・値を決めるもの:

- 動画providerとtranscode/CDN契約
- 広告platformごとのscope、API version、費用取込
- EC provider/shopとconnector権限
- 決済provider、返金、webhook
- Google Calendarの対象calendarと競合優先
- affiliateの税・源泉・支払format
- 写真AI provider、保持、同意文面
- operator通知の代替channelと勤務時間

未決定値はfeature flagで閉じ、画面へ使えない操作を出さない。
