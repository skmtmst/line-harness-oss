# V6 21 NEN配信 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 21-x、現行NEN campaign/column/pet/birthday coupon、EC event、配信job

## 0. 結論と採点

V6は、購入直後、発送、到着後、口コミ、再購入、コラム、ペット誕生日を、ECの出来事と顧客情報から自動送信するNEN専用のcustomer journeyである。Lステップの汎用scenarioを業務向けに分かりやすく組み直しており、NEN事業では明確に上回れる。

現行にはEC event、HMAC、購入後job、5回retry、LINE Proxy、送信log、コラム同期、pet profile、誕生日coupon、test送信、重複防止がある。ただしcampaign設定・birthday設定・column・pet・jobの管理APIがLINEアカウントで絞られず、実質全社共通である。送信時に最新campaign本文を再読込するため、公開中の文面編集が既に待っているjobへそのまま効く。誕生日couponは「誕生日3日前」ではなく誕生月1日に即時queueされるためV6と一致しない。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 99 | 100 | EC起点を運用者の言葉で一本化 |
| Lステップ対抗力 | 100 | 100 | 汎用設定よりNEN業務に強い |
| 現行実装完成度 | 71 | 99 | dispatcherはあるが版・境界・分析不足 |
| データ安全性 | 29 | 100 | 全社共通設定と待機job書換えがP0 |
| 実現可能性 | 98 | 100 | 既存EC/LINE/job基盤を拡張可能 |
| 要件確定度 | 98 | 100 | 到着event・開封の取得限界を固定すれば可能 |

不可能・除外は、配送会社/ECから到着eventがないのに「届いた」と断定すること、LINE個人単位の開封、配信が購入を生んだという因果の断定、正確な健康・医療診断、公開中定義の直接上書き、全待機jobへの黙った文面変更、重複配信の手動強制、外部EC coupon発行を分散transactionで完全同期とみなすことである。

## 1. V6実Node

| Node ID | 画面 |
|---|---|
| `VLMGH` | 配信flow |
| `DEX0k` | NEN column |
| `q4lajm` | pet・記念日 |
| `WeXbL` | 配信履歴 |
| `HpKyF` | 配信内容編集 |
| `ymXJK` | column作成 |
| `i9sQP` | column空・読込・error |

4画面は1920×1080、3画面は1920×1136。Pencilのテキスト・構造を確認した。画像出力ノイズのためピクセル比較は未完。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

V6の「開封」は原則「記事を開いた」「linkを押した」「回答した」へ変更する。LINE Messaging APIで取得できる集計値が対象・最小母数を満たす場合だけ、出典と母数付きで開封を表示する。

## 2. Lステップとの差

この機能が実行するアクション(タグ、友だち情報、シナリオ、LINE送信、通知、外部Webhook、リッチメニュー、マイル、コンバージョン、予約操作)は、[25 接続契約](./v6-25-automation-action-contract.md)のカタログ名・入力・安全条件と、共通基盤 §6-2 の再試行既定に従う。25 の実行エンジンを経由しない直接実行でも、同じ冪等キーと実行台帳の状態名を使う。

Lステップは[リマインダ配信](https://linestep.jp/lp/01/features24.html)、[コンバージョン管理](https://linestep.jp/lp/01/features39.html)、回答フォーム、scenario、tagを組み合わせれば近い運用ができる。V6はそれらを「注文・発送・到着・pet誕生日」というNENの言葉へ変換して一画面で提供する。

上回る条件:

- EC eventと送信jobが一対一に追える
- 1注文・1pet・1記念日ごとの重複を構造的に防ぐ
- 配送状態が実測か予定かを区別
- published versionとqueue snapshotで安全に編集
- coupon発行、LINE送信、利用、成果の失敗をreconciliation
- 健康情報・pet情報の同意と保持を管理

## 3. triggerの正式定義

| flow | trigger | 代替 |
|---|---|---|
| 注文ありがとう | `order.confirmed` | なし |
| 発送案内 | `shipment.shipped` | なし |
| 到着翌日 | `shipment.delivered` | eventがなければ「到着予定日の翌日」と表示 |
| 3/7/30日後 | deliveredまたは予定基準 | 基準種別を表示 |
| 口コミ済み除外 | review submission/EC review ID | 取得できなければ除外条件を使わない |
| 誕生日 | petのmonth/day＋timezone | 年不明なら年齢を出さない |
| column | scheduled publication | audience snapshot |

発送日＋固定5日を「到着」と呼ばない。carrier webhookやEC deliveredがない場合は予想到着であり、delay・誤差を画面に示す。

## 4. published versionとjob snapshot

- flow definitionとcolumnはversionを持つ
- 公開済みversionを直接編集しない
- 新版公開後に作られるjobだけが新版を使う
- 既存pending jobは予約時のmessage/action/variables snapshotを保持
- 管理者が既存pendingを新版へ移す場合は対象件数、差分、送信時刻を確認し、migration eventを記録
- stopは新規job作成を止めるだけかpendingもcancelするかを選ぶ。既定は新規停止＋pending確認
- 31機能設定オフ、32緊急停止は別判定

この機能の利用先（送信job、column配信、誕生日job）は**スナップショット型**である（`v6-32-feature-cross-review.md` §2）。理由: 公開中の文面編集が既に待っているjobへ黙って効かないよう、jobは予約時の版とrender snapshotで完走させる必要があるため。

現行のjob payloadにはEC eventだけで本文がなく、送信時に最新設定を読む。これをversion IDとrender snapshotへ移行する。

## 5. audienceと抑止

送信直前に次を再検証する。

- 同じLINEアカウント
- following、配信停止、NEN column停止、対象機能権限
- source order/pet/columnの現在状態
- 注文取消・返金・未発送
- review済み、coupon発行済み、同一抑止期間
- quiet hours、休日、timezone
- 運用kill switch
- LINE送信枠

同じ人・同じ注文・同じflow・同じversionのidempotency keyを持つ。30日抑止は案件/商品/family単位を明記し、複数pet・複数注文を不当にまとめない。

## 6. column

- 記事本文の正本はEC/CMSかLINE Harnessかをcolumnごとに明示。初期はEC/CMS正本、Harnessは配信introとscheduleを管理
- external event ID、revision、slug、accountをuniqueにする
- HMACはtimestamp＋event ID＋raw body、replay ledgerを持つ
- 対象条件は6一斉配信と同じsegment engine
- queue時にaudience snapshotを非同期生成し、1件ずつ同期insertしない
- recipient count、除外理由、LINE通数見込みを公開前に表示
- titleは通知で切れる目安を示すが、20文字を絶対保証と表記しない
- 画像/本文は14共通情報・15mediaとversion参照
- 読了はtracked article page、CTA click、scroll等取得できるeventだけ

「売らない配信でblock率が下がる」「この書き方で12pt高い」は、十分な母数・比較期間・統計条件がある時だけ推奨表示する。相関を因果として断定しない。

## 7. pet・誕生日・coupon

pet profile:

- pet ID、owner friend、name、species、breed、sex、birthday precision、timezone、source、consent、updated_at
- `birthday_precision`: full_date / month_day / unknown
- 年が不明なら年齢を表示しない
- 同一ownerに複数petを許可
- EC external IDのowner移動は監査とconflict review
- 物理削除せずarchive。関連配信とcouponは保持

誕生日job:

- 毎日、対象timezoneの将来N日を作る
- V6既定は誕生日3日前10:00
- 同一pet×birthday year×flow versionで一回
- 2月29日の扱いは07リマインダの正本に従う（設定者が2/28・3/1・その年は送らないを選ぶ。既定2/28）
- pet情報修正時は旧jobをcancelし新版を作る

coupon:

- coupon issue IDとcodeは一意・guess困難
- valid_from/to、discount、minimum purchase、target customer/pet、usage limitをsnapshot
- EC作成はoutbox→delivery→確認のsaga
- EC成功/DB失敗、DB成功/EC失敗をreconciliation
- coupon利用eventでused_atとconversionを更新
- 作成失敗時はLINEを送らない。要対応へ

## 8. delivery execution

状態:

```text
planned → queued → claimed → sent
                    ├→ retry_wait → claimed
                    ├→ skipped
                    └→ permanent_failed
```

- `attempts`に加え`next_retry_at`、error code、provider request ID
- retryの回数・間隔は共通基盤（`v6-shared-platform-requirements.md`）§6-2の既定に従い、画面に出す最大回数と一致させる
- 5分cron×30件という固定容量をSLOにしない。Queue consumerとaccount別rate limitへ
- claim leaseとtimeout recovery
- 送信直前にversion snapshot、friend、停止、quotaを検査
- provider success後のDB失敗をidempotency keyで照合
- 手動「もう一度送る」は恒久失敗だけ、同じidempotencyを再利用せずretry attemptとして記録
- 「待っているものを今すぐ送る」は全件強制せず、件数・quota・quiet hours・除外をpreview

## 9. metrics

- sent: providerが受理したmessage
- delivered: LINEでは個別保証できないため原則表示しない
- opened: 取得条件を満たすaggregate insightだけ
- link opened/clicked: tracked redirect
- answered: form/question success
- coupon issued/used
- associated conversions: 19conversionのattribution window内。因果を断定しない
- block/unfollow: campaign送信後windowとの関連値。少人数は非表示
- comparator: 同期間・同対象の通常配信を明記

「押された割合」の分母は送信成功unique friend、「成果」はunique conversionまたは売上を明示する。未取得を0にしない。

## 10. account境界とAPI

現行のoverview/settings/jobs/columns/pets/couponはほぼ全体集計である。全APIへaccount必須とscope検査を追加する。

- flow definitions/versions/publish/stop/impact
- columns sync/list/version/schedule
- pet list/detail/create/update/archive/conflict
- birthday rule/coupon issue/reconcile
- delivery batches/jobs/retry/cancel
- metrics/detail/CSV
- test send

test送信は同じaccountの検証済みtest recipientだけ。実注文番号・住所・couponを使わずsample datasetを明示する。

## 11. 権限・内容安全

- view、edit、publish、send/retry、pet PII、exportを分離
- pet健康・誕生日は項目マスクと目的同意を適用
- 医療・栄養claimは専門家review、出典、review期限をcontent metadataに持つ
- diagnosis、治療指示、効果保証を自動生成しない
- 相談誘導と緊急時の獣医受診案内を定型化
- 配信公開、coupon金額、bulk sendは重要操作として監査

## 12. 状態

- flow draft/published/paused、pending job影響あり
- event実測/予定/不足
- column draft/scheduled/queueing/sent/failed
- pet誕生日full/month-day/missing、conflict
- coupon creating/active/used/expired/failed/reconcile
- delivery queued/retry/skipped/permanent failed
- empty/loading/error/permission/feature off
- metrics unavailable/small sample/stale
- version conflict

## 13. 既存移行

1. global campaign/birthday設定をaccount別に棚卸し
2. jobのline_account_id、friend account、payloadを照合
3. account不明を隔離し自動送信停止
4. current settingsをversion 1へsnapshot
5. pending jobへ現在のrender snapshotをdry-run生成し差分確認
6. birthday issue dateとV6 3日前ruleの差を抽出し、二重発行を防止
7. legacy sent/failedをhistoryへ移行。開封値を捏造しない
8. pet外部ID重複・birthday precisionをreview

## 14. 除外

- 到着eventなしの到着断定
- LINE個人開封・到達保証
- 配信と購入の因果断定
- 医療診断・効果保証
- 公開済みversion直接編集
- pending jobの黙った一括変更
- 強制一括再送
- 自前couponとEC couponを無照合で成功扱い
- 年不明のpet年齢表示
- pet・配信・coupon履歴の物理削除

## 15. 完了条件

- V6 7画面すべてで、空・読み込み中・失敗・権限不足の 4 状態が共通部品 `ListState` で描画され、契約テストが通る
- 主操作ごとに、成功・失敗・権限不足(`view` と `none`)の 3 経路を自動テストで確認する
- 画面遷移は `scripts/visual-qa/screens.mjs` の対象画面一覧と過不足なく一致する
- 全API・集計がaccount scoped
- 実測/予定のtriggerが画面で区別される
- 公開版・job snapshotにより編集で待機中本文が変わらない
- 同一sourceで二重送信・二重couponがない
- coupon sagaをreconcileできる
- 3日前birthdayとtimezone/leap dayをtest
- open/click/answer/conversionを取得可能性どおり表示
- permanent failureを要対応から再試行可能
- 1440/1920で横スクロールなし
- 設計との画像比較は共通工程ゲート(`v6-shared-platform-requirements.md` §10「工程ゲート」)に従う。要件の完了条件には含めない

## 16. 実装順

1. account境界と送信停止gate
2. definition/version/job snapshot
3. Queue、retry、reconciliation
4. delivered/predicted trigger
5. birthday/coupon saga
6. column audience batchとmetrics
7. pet consent/archiveとcontent review
8. V6画面、migration、E2E、画像比較

## 17. 実装照合の進捗（2026-08-28）

今回、既存の配信job・キャンペーン設定・LINEアカウントを作り直さず、次のP0安全要件を先に接続した。

- 新しく予約するjobは、その時点の配信見出し・本文・ボタン・画像をsnapshotとして保持する
- 既存の未送信jobは、移行時点の設定を初回snapshotとして固定する
- 送信時は現在の設定本文を使わず、予約時snapshotを使う
- job・友だち・LINEアカウントが同じaccountであることを再確認する
- 対象accountの送信tokenが無い場合は、既定tokenへ逃がさず送信を止める
- snapshotが欠ける・壊れる・別campaignのものである場合は送信を止め、理由を履歴へ残す
- 既存の`account_settings`を再利用し、配信文・配信ON/OFF・誕生日coupon設定をLINEアカウント別に保存する
- 概要、設定、配信履歴、column、pet、couponの管理APIは選択中LINEアカウントを必須にし、別アカウントを混ぜない
- account未確定のcolumnは一覧と配信対象へ出さず、EC同期時にaccountが指定されたものだけを扱う
- アカウント切替中に前の読み込み結果が戻っても、新しい画面へ上書きしない
- 配信履歴の`sent`、`pending`、`failed`等は運用者向けの日本語で表示する
- 誕生日couponは誕生日の3日前10:00 JSTに予約し、年またぎを試験した。2月29日は07の方針（既定2/28、設定者が選択）に従い、非うるう年に推測で送らない

まだ完了ではない。公開版、到着予測、2月29日の選択可能な方針、coupon照合、column本文作成、比較指標、恒久失敗の再試行、V6 7画面、最新headの画像比較は後続実装とする。本変更では本番DB更新・配備を行わない。
