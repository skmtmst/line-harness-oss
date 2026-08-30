# V6 23 EC連携 要件定義（実装照合版・下書き）

更新日: 2026-08-26
対象: V6 23-x、現行EC event・会員snapshot・LINE通知・NEN配信・タグ

## 0. 結論と採点

V6は、ECの注文・入金・発送・返金・会員・定期便を、LINEの友だち、配信、成果、マイル、分析へつなぐ運用画面である。Lステップの外部連携をNENのEC業務へ具体化しており、実装可能である。

現行にはEC-CUBE webhook、HMAC、5分replay防止、event id冪等、処理台帳、EC会員snapshot、注文/定期便JSON、LINE送信、タグ、NEN配信jobがある。しかしV6はShopify接続・email/電話による照合・未照合queue・接続設定・再試行・定期便riskを示す一方、現行eventは`line_user_id`必須で、EC-CUBE単一secret・全体設定である。未照合顧客を受け取れず、V6の主要画面を現行データだけでは実現できない。

| 評価軸 | 現在 | 要件反映後 | 判断 |
|---|---:|---:|---|
| V6 UI/UX | 98 | 100 | event→照合→定期便→接続の流れが明快 |
| Lステップ対抗力 | 100 | 100 | EC業務とLINE actionを一本化する独自優位 |
| 現行実装完成度 | 68 | 99 | secure webhookと台帳はあるがconnector/identity/管理API不足 |
| データ安全性 | 36 | 100 | 全体secret、account境界、PII照合、retryがP0 |
| 実現可能性 | 96 | 100 | connector adapterとidentity台帳の追加で可能 |
| 要件確定度 | 97 | 100 | Shopify契約差をadapterとして切り離せば確定可能 |

不可能・除外は、名前だけの自動名寄せ、「止めそう」の確実な予測、LINE未開封の個人取得、ECの全platformを同一仕様で完全制御、配送会社eventなしの到着断定、返金と成果・マイル取消を単一transactionとみなすこと、取り込み停止時に外部EC自体を停止することである。

## 1. V6実Node

| Node ID | 画面 |
|---|---|
| `eI3gs` | 取り込みの記録 |
| `ELayY` | 会員のつき合わせ |
| `bfB50` | 定期便 |
| `oHAN4` | EC連携のつなぎ先 |

3画面は1920×1080、つなぎ先は1920×1136。Pencilのテキスト・構造を確認した。対象V6は同日のV5修正を含めて複製された正本で、本監査中の追加編集はしていない。

V6の「メールアドレスか電話番号で結びつけています」は正式には、正規化後の検証済み値が同じ場合だけ候補にする。「名前と郵便番号」は自動確定せず人の候補確認へ変更する。「LINE本店/二号店」を跨ぐ候補は組織権限があっても自動連結しない。

## 2. Lステップとの差

Lステップはwebhook、流入経路、conversion、tag、scenarioを組み合わせてECの結果をLINE施策へ使える。V6はconnector状態、raw event、顧客照合、注文・定期便snapshot、返金による調整、関連actionを一つの運用台帳にする。

V6が上回る条件:

- EC eventをraw receiptから各actionまで一意に追う
- 接続先・account・shopごとにsecretとscopeを分離
- email/電話/EC customer IDのidentity候補と人の判断を履歴化
- refund/cancelを成果・マイル・配信の調整としてreconcile
- 定期便riskは根拠と精度を示し、配信対象を人が確認
- external event schemaをversion化し、connector差をadapterで吸収

## 3. 主タスクと用語

運用者の主タスクは、EC接続が正常か確認し、届いたeventの処理結果を追い、未照合のEC顧客を正しいLINE友だちへ安全に結び、定期便の状態を確認して必要な配信へ進むことである。

- connector: Shopify/EC-CUBE等の接続単位
- shop: 外部EC店舗
- receipt: 受け取ったraw webhook
- normalized event: 共通schemaへ変換した出来事
- identity candidate: EC顧客とfriendの候補
- link decision: 人が結ぶ/結ばない/保留した判断
- member snapshot: 現時点の注文・定期便・ポイント等
- action execution: LINE、タグ、成果、マイル、NEN配信の個別実行

## 4. connectorとsecret

現行は環境変数`ECCUBE_WEBHOOK_SECRET`と`NEN_EC_BASE_URL`が全体で一つである。V6はconnector単位へ移行する。

- organization/account/shop/provider/environmentを保持
- secret/tokenは暗号化し、通常APIは末尾4文字と更新日だけ
- inbound HMAC secretとoutbound API tokenを分離
- secret rotationは旧新を短期間併用し、切替時刻を記録
- webhook URLはguess困難なconnector ID。secretが主認証
- scope、event subscription、last receipt、last success、error、rate limitを表示
- 接続testはsample eventで行い、実顧客へLINEを送らない
- 「取り込みを止める」は受信を監査保存しつつactionを停止する安全pauseを既定にする。完全拒否は別操作
- 停止影響としてNEN配信、conversion、mileage、tag、analyticsの件数をpreview

Shopify・EC-CUBEはprovider adapterにする。platform固有API、scope、webhook topic、検証方法を共通画面から隠しすぎず、接続詳細で表示する。

## 5. event受信・正規化

状態:

```text
received → verified → normalized → identity_pending/ready
                                  → processing → processed
                                               ├→ retry_wait → processing
                                               ├→ partial_failed
                                               ├→ skipped
                                               └→ permanent_failed
```

- raw body byte上限、timestamp、HMAC、replayを検証
- idempotencyはconnector×external event ID。IDがないproviderは安定hash＋topic
- raw receiptは改変せず暗号化/アクセス制限して保持
- normalized schema version、adapter version、occurred_at、received_atを保持
- event順序逆転を想定し、external object version/updated_atで古いsnapshotを上書きしない
- providerへ2xxを早く返し、重い処理はQueueへ
- claim lease、next retry、exponential backoff＋jitter、dead letter
- event一件のLINE、tag、conversion、mileage、snapshotを別action executionとして追う
- 一つ失敗しても他を成功扱いにでき、全体はpartial failedと表示

現行はhandler内でsnapshot、tag、LINE、event fireまで同期処理する。途中失敗の再実行で副作用が重複しないよう、receipt→Queue→action ledgerへ分離する。

## 6. 共通event schema

初期対応:

- customer.created/updated
- order.confirmed/payment_received/cancelled/refunded
- fulfillment.shipped/delivered（providerが出す場合のみ）
- subscription.started/upcoming/paused/resumed/payment_failed/cancelled
- points.changed（取得できるproviderのみ）

必須共通項目:

- connector/shop/external event ID/type/schema version
- external customer/order/subscription IDs
- occurred/received timestamps、currency、amount
- customer identity候補値
- line items、discount、shipping、tax、refund snapshot
- provider raw reference

「注文が確定」「入金」「発送」「届いた」はproviderごとに意味が違うため、adapter mappingと検証fixtureを契約testにする。`delivered`がない場合は予定日と明記する。

## 7. identity照合

現行eventは`line_user_id`必須で、未照合を受け取れない。event受信はLINE IDなしでも許可し、identity解決を別工程にする。

候補の優先順位:

1. 同一connectorの確定済みexternal customer ID link
2. 検証済みemailの正規化一致
3. 検証済み電話番号のE.164一致
4. emailと電話の両方一致
5. 名前＋郵便番号等は人の候補。自動確定しない

- email/phoneは暗号化原値＋検索用HMAC hash。平文を広域listへ返さない
- account/shopを跨ぐ候補は自動確定しない
- 一対多・多対一を検知し、重複会員疑いへ
- `link decision`: linked/rejected/deferred/merged_externalを理由・actor・時刻付きで追記
- 「しない」はその候補pairを抑止し、次回同じ根拠で再提示しない
- 手動link前に影響する注文数、売上、tag、成果、mileage、配信jobをpreview
- 過去eventを再処理する範囲を選ぶ。既定は分析snapshot更新、顧客LINEの過去送信はしない
- 招待は24顧客通知/6配信を使い、EC個人情報を本文へ出しすぎない

名前だけ、名前＋曖昧住所、AI類似度だけの自動連結は禁止する。

## 8. member・注文・定期便モデル

現行`nen_ec_member_snapshots`はorders/subscriptionをJSONで最大50/20件へ上書きする。表示cacheとしては使えるが、監査・集計の正本にはしない。

正規化台帳:

- ec_customers / customer_identities / friend_links
- ec_orders / order_lines / payments / refunds / fulfillments
- ec_subscriptions / subscription_items / subscription_events
- ec_event_receipts / normalized_events / action_executions
- member snapshotは上記から作るread model

金額、currency、税、送料、割引、返金を整数minor unitで保持する。注文・定期便の外部状態を原文とnormalized stateの両方で保存する。過去eventをJSON上書きだけで失わない。

## 9. 定期便risk

V6の「止めそう」は予測であり、事実ではない。

- 初期はrule-based riskに限定
- 根拠例: payment failed、pause履歴、次回変更期限、問い合わせtag、tracked link反応低下、配送間隔異常
- LINE個人開封は使わない。V6の「3回開いていません」は取得できるtracked link/記事反応へ変更
- score、根拠、計算時刻、rule versionを表示
- 正解label（継続/停止）を蓄積し、precision/recallと期間を管理
- 母数不足では「予測」順位を出さず、事実filterだけ
- riskだけで自動割引・自動送信しない。運用者が対象と文面を確認
- 健康・相談内容を使う場合は目的同意と機微情報権限を要求

「止めた理由」はEC解約アンケート等の明示eventだけ。受信箱本文から勝手に確定しない。

## 10. actionと分散整合

normalized eventから次を独立実行する。

- EC transactional LINE
- 21 NEN配信trigger/job
- 19 conversion event/adjustment
- 17 mileage credit/debit
- 4 friend tag/field
- 20 analytics event

各actionはevent×action type×rule versionのidempotency keyを持つ。refund/cancelは元成果・mileageを直接削除せずadjustmentを作る。LINE送信済みは取消不能のため、必要なら訂正通知を別actionとして人が判断する。

event処理済みとLINE送信成功を同じstatusにしない。V6一覧の「送信完了」はactionごとの結果を開いて確認できるようにする。「もう一度やる」は失敗actionだけを選び、既に成功したpoint/LINEを重複させない。

## 11. API

- connectors list/create/update/test/rotate/pause/resume/impact
- receipts/events list/detail/retry/dead-letter
- mappings/schema versions/fixtures
- identity candidates/list/decision/bulk禁止条件
- customers/orders/subscriptions/read models
- action executions/retry/skip/reconcile
- subscription risk/list/detail/version/metrics
- connection health/SLO/export

全APIはaccount/connector scope、server permission、expected versionを必須にする。検索はPII権限を持つ利用者だけ。CSVは項目マスク、目的、監査、期限付きdownloadを適用する。

## 12. 権限・監査

- ec.view、ec.pii、ec.identity_link
- ec.connector_manage、ec.secret_rotate
- ec.retry、ec.pause
- ec.subscription_campaign
- ec.export

接続停止、secret表示/rotation、identity確定、過去event再処理、返金調整、bulk配信は重要操作として監査する。secret全値は再表示しない。connector設定変更は二者承認を選択可能にする。

## 13. 状態とSLO

- connector connected/degraded/paused/auth expired/rate limited
- receipt verified/rejected/replayed/oversized
- event received/processing/partial/retry/permanent failed/skipped
- identity linked/candidate/unmatched/conflict/rejected
- order current/refunded/cancelled、subscription active/paused/failed/cancelled
- action sent/skipped/retry/permanent failed
- data freshness fresh/stale/unavailable
- empty/loading/error/permission/feature off

V6の「ふつうは1分以内」はSLOとして定義し、例: 95%を5分以内など実測で表示する。最後に届いた時刻と最後に正常処理した時刻を分ける。

## 14. 既存移行

1. 現行EC-CUBE secret、event、snapshot、notification settingsの利用accountを棚卸し
2. account不明のevent/settingは隔離し、新規actionを停止
3. 現行接続をconnector version 1へ登録し、secretを暗号化移管
4. `ec_events`をreceipt/normalized/actionへ分解backfill。raw payload hashと件数を照合
5. `line_user_id`とfriendの確定linkをlegacy evidence付きでidentity link化
6. orders/subscriptions JSONから正規化recordを作るが、raw eventと矛盾するものはreview
7. current snapshotを新read modelと比較し、金額・件数・最新日を照合
8. dual processingはshadow modeでactionを実送信せず差分確認
9. cutover時に旧handlerの副作用を止め、同一event idの二重処理を防止

## 15. 除外

- 名前だけ・曖昧住所・AI類似度だけの自動名寄せ
- 「止めそう」の確実性保証、自動割引、自動送信
- LINE個人開封によるrisk判定
- providerにない到着eventの断定
- 全EC platformの同一仕様・全操作対応
- 送信済みLINEの取消
- refundで過去成果・mileage履歴を物理削除
- 外部EC、LINE、DBを単一transaction扱い
- secret全値の通常再表示
- 過去注文eventの顧客LINE一括再送

## 16. 完了条件

- V6 4画面の主操作・状態・遷移が動く
- connector/shop/accountごとのsecret・scope境界testが通る
- LINE IDなしeventを受け、未照合queueへ安全に出せる
- 確定identity linkと人の判断履歴を再現できる
- 同一event再送でLINE・成果・mileageが重複しない
- partial failureから失敗actionだけ再試行できる
- refund/cancelがadjustmentになり元履歴を残す
- 定期便riskに根拠・rule version・鮮度を表示し、個人開封を使わない
- event順序逆転、retry、connector停止、secret rotationをtest
- 1440/1920で横スクロールなし
- V6実Nodeと同幅画像比較を添付

## 17. 実装順

1. account境界、connector、secret暗号化
2. receipt→Queue→normalized event→action ledger
3. identity候補・判断・未照合queue
4. 注文/定期便の正規化台帳とread model
5. LINE/成果/mileage/tag/分析のidempotent action
6. retry、dead letter、reconciliation、SLO
7. 定期便risk、V6画面、migration、E2E、画像比較

## 18. 実装照合の進捗（2026-08-28）

今回、既存のEC-CUBE webhook・HMAC・イベント台帳・会員snapshotを作り直さず、最優先のaccount境界と未照合受付を先に追加した。

- webhookは対象LINEアカウントの指定を必須にする
- eventをLINEアカウントへ固定し、同じ外部event IDでも別accountなら別件として保持する
- friend照合は指定accountの中だけで行い、別accountの同じLINE userへ結ばない
- 対象accountのLINE tokenが無ければ既定tokenへ逃がさない
- LINE IDが無い・一致するfriendがいないeventも捨てず、`identity_pending`として残す
- 管理画面の概要・event一覧を、選択中または権限内のaccountだけに限定する
- V6で「会員の確認待ち」を0件と混同せず表示する

まだ完了ではない。connector別secret、Queueとaction ledger、email/電話候補、注文・定期便の正規化、V6 4画面、画像比較は後続実装とする。本変更では本番DB更新・配備を行わない。
