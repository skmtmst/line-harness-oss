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
- 新版公開後の既存利用先の扱いは、次の2分類だけを使う。機能ごとに第3の流儀を作らない

| 分類 | 定義 | 挙動 | 該当 |
|---|---|---|---|
| 参照型利用先 | URLや定義IDで「定義そのもの」を指す公開面 | 公開時点の最新公開版を表示する。ただし開始済みの回答・実行は開始時の版で完走する | 回答フォームの回答URL(13)、LIFF画面、リッチメニューの公開alias(12)、予約ページ(28) |
| スナップショット型利用先 | 配信job、ステップ、挿入先、通知定義など「版を取り込んで動く」もの | 版を固定する。新版への切替は利用先ごとに件数と差分を確認してから行い、migration eventを記録する | シナリオ(05)、一斉配信(06)、リマインダ(07)、テンプレート挿入(11)、共通情報(14)、メディア(15)、通知(24)、オートメーション(25) |

- 各要件書の版の章に、その機能の利用先がどちらの分類かを1行で明記する
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
- 22写真審査の「採用ポイント」は外部ECのポイントであり、mileageとは別の台帳。画面では「ECポイント」と呼び、「マイル」と混ぜない。17と22に相互参照を置く

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

## 7. V6デザインへの修正依頼の集約

機能別要件に散在していたPencil側の修正依頼をここへ集める。**設計を変えるときはPencilを先に直す**(`docs/v6-common-rules.md`)ため、実装前にこの一覧をPencilへ反映し、反映した項目に日付を付ける。各機能側の記述は残すが、正本はこの表である。

| # | 機能 | 画面 | 修正 | 出典 |
|---:|---|---|---|---|
| 1 | 02 受信箱 | 全画面 | 「対応マーク」を「対応状況」へ。友だち属性の対応マークは右パネルの別項目として表示 | 02 §3、§19 |
| 2 | 03 友だち | 一覧・詳細 | 「相手から／自分から」を「LINEでブロック／管理画面で非表示」へ | 03 §23 |
| 3 | 03 友だち | 一覧・一括操作 | 「対応マーク」が固定の対応状況か自由マークかを画面上で分ける | 03 §23 |
| 4 | 03 友だち | UID移行 | 「異なるプロバイダーはAPIで自動対応できない」を常設 | 03 §23 |
| 5 | 03 友だち | 統合前確認 | 利用目的と同意・規約の確認欄を追加 | 03 §23 |
| 6 | 03 友だち | CSV | CSV操作の専用画面またはUID移行内の別モードを追加 | 03 §23 |
| 7 | 04 属性 | 4-1 | 上部に「対象アカウント範囲」を追加 | 04 §20 |
| 8 | 04 属性 | 4-1-C | 保存先を「共通アクション・オートメーション」と明記 | 04 §20 |
| 9 | 04 属性 | 4-1-F | 既定操作を「アーカイブ」に変更し、代替・使用版を表示 | 04 §20 |
| 10 | 04 属性 | 4-1-H | 解析結果、重複、要修正、実行結果の状態を追加 | 04 §20 |
| 11 | 04 属性 | 4-2-A | 画像・PDFは差し込み不可、メディア参照であることを表示 | 04 §20 |
| 12 | 04 属性 | 4-2-B | 切戻し期限、変換不可の個別修正導線を追加 | 04 §20 |
| 13 | 04 属性 | 4-3 | 「対応状況とは別の自由分類」と明記 | 04 §20 |
| 14 | 04 属性 | 4-3-B | 置換先を必須選択として追加 | 04 §20 |
| 15 | 04 属性 | 4-4 | 所有者、対象範囲、ライブ/固定、revisionを表示 | 04 §20 |
| 16 | 04 属性 | 4-4-A | 「次回実行から変わる」はライブ参照時だけ表示 | 04 §20 |
| 17 | 09 追加時配信 | 9-1-A/B/C/I | 設定は1枚・削除概念なし・本文はシナリオ側のため、4画面を削除または非表示タグ | `scripts/visual-qa/screens.mjs` gap:'drop' |
| 18 | 10 ウェビナー | 10-1-K | 視聴履歴の物理削除を禁止するため削除確認を削除し「アーカイブ確認」へ | 同上 |
| 19 | 13 回答フォーム | 13-1-B | デザイン設定は作らない方針のため削除 | 同上 |
| 20 | 16 アフィリエイト | 16-1-G | 支払記録の物理削除を禁止するため削除確認を「アーカイブ確認」へ | 同上 |
| 21 | 全機能 | 権限不足状態 | `forbidden`に対応する設計部品が無い。共通部品`ListState`の権限不足状態を1枚描く | `apps/web/src/components/shared/list-state.tsx` |
| 22 | 全機能 | 本文見出し | トップバーの画面名と本文H1の二重表示を禁止する規則を、設計画像側でも徹底 | `docs/v6-common-rules.md` §1-1 |
| 23 | 01 ダッシュボード | `NjK9q` | 「対応が必要な受信」カードの値が`5件表示`になっている(`vUXKb`は`5件`)。プルダウン文言の混入を直す | 01 §1 |
| 24 | 01 ダッシュボード | `vUXKb` `NjK9q` | 「今日やること」右の並び順ラベルが「優先度順」と「優先度が高い順」で揺れている。1つに揃える | 01 §1 |
| 25 | 01 ダッシュボード | `vUXKb` `Alekb` `JN6mQ` `NjK9q` | 「接続状態」の有効友だちが398人と4人で画面ごとに違う。見本データを揃える | 01 §1 |
| 26 | 01 ダッシュボード | `vUXKb` | 「今月の送信枠」の`197 / 200通`と「残り98.5%」が使用数か残りか読めない。「使用 197 / 上限 200通」の形にする | 01 §1、§14 |
| 27 | 01 ダッシュボード | `NjK9q` | プルダウンの選択印が共通部品`Gfsb4`と違う | `docs/design-qa/dashboard-v6/design-qa.md` |
| 28 | 33 アカウント設定 | 新規 | LINEアカウント一覧(L)、登録(E)、詳細・編集(D)、乗り換え・引き継ぎ(E)の4画面を追加 | 33 §5-2 |
| 29 | 34 はじめの設定と案内 | 新規 | はじめの設定(B)、レシピ一覧(L)、レシピを複製する(E)、マニュアルの正本表(L・運営側)の4画面を追加 | 34 §5 |

Pencilの画面数は、17〜20と28〜29を反映すると260から変わる。反映後に`docs/v6-canonical-design-decision.md`の実測値を更新する。

## 8. 共通監査

次を追記で残す。

- actor、role、organization/account
- action、target type/ID
- before/afterの安全な差分
- reason、approval、request/trace ID
- version、idempotency key
- occurred/recorded time、timezone
- external provider reference

secret、本文PII、URL query、画像original等を監査logへ直接書かない。high-risk操作は再認証、必要に応じ二者承認を使う。

## 9. 100点へ近づける共通条件

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
- 設計との画像比較は共通工程ゲート(共通基盤要件 §10)で担保する。要件の完了条件には含めない
- `準備中`または無効な見せかけbuttonがない

## 10. 残る外部判断

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
