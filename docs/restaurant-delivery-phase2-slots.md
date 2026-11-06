> 文書：デリバリー フェーズ2の受け皿（画面なし）｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# デリバリー フェーズ2の受け皿（画面なし）

## この文書の役割

2026-10-10 に利用者から事前共有された**フェーズ2（LINE自社デリバリー受注＋配送アグリゲーション）**で、
表の作り直しや大きな書き換えが起きないように、**画面を1枚も増やさずに裏側の置き場だけ**を先に用意した。
その置き場が何で、フェーズ2で何をどこへ足すのかを書き残す。

- 対象は受け皿（DBの列・表、差し替え口の型）だけ。注文の動きは変えていない。
- 新規UIは無いので、Pencil のデザイン承認は要らない（既存承認：デリバリー受注_v02.pen の D-1〜D-6、2026-10-09）。
- 既存3サービス（Uber Eats・出前館・ロケットナウ）の受注は従来どおり動く。

## 先に足した受け皿は3つ

### 1. 店舗ごとの機能の入り切り — `rt_store_feature_flags`（移行 683）

**なぜ必要か。** これまでの入り切りは LINE アカウント単位の `restaurant_test`（`packages/shared/src/feature-catalog.ts`）
1本しか無く、`account_settings` に保存される。つまり「飲食店機能をまるごと使うか使わないか」しか選べず、
**「この店舗はデリバリーだけ止める」「予約は使うがクーポンは使わない」が作れなかった**。

| 列 | 置くもの |
| --- | --- |
| `store_id` + `feature` | 主キー。`feature` は `delivery` / `delivery_line_direct` / `delivery_dispatch` / `reservation` / `coupon` |
| `enabled` | 0/1。既定は 0（切）。足した時点で勝手に開かない |
| `config_json` | 閾値の置き場（JSON）。自社配送へ切り替える基準金額・手数料率・配達最大半径・API優先度 |
| `updated_by` / `version` / `created_at` / `updated_at` | 既存の飲食店向け表と同じ作法。時刻は**エポック秒** |

`config_json` を最初から持たせたのは、閾値を1つ足すたびに表を作り直さずに済ませるため。
閾値の既定値（自社配送へ切り替える基準金額 1,200円 など）はコード側に持ち、保存値があればそれを使う。

**既存の仕組みを置き換えるものではない。** 判定は従来と重ねて使う:

1. 環境の元栓 `RESTAURANT_TEST_ENABLED`（`apps/worker/src/lib/environment-features.ts`）
2. テナントの機能パック `tenants.feature_packs` に `restaurant`（`apps/worker/src/services/tenant-features.ts`）
3. アカウントの `restaurant_test`（`isAccountFeatureEnabled`）
4. **（新）店舗ごとの `rt_store_feature_flags`**

4 は 1〜3 を細かくするだけで、緩める向きには働かせない。経路の入口の作り（`feature()` ミドルウェア、
`feature-route-manifest.test.ts` が凍結している対応表）は触っていない。

### 2. 注文表の項目追加 — `rt_delivery_orders`（移行 683 で作り直し）

**なぜ作り直したか。** `service` の CHECK が3サービスしか許しておらず、LINE から直接受けた注文は
**そもそも1行も入れられなかった**。SQLite は `ALTER TABLE` で CHECK を変えられないため、
表の作り直し（`-- migration-policy: table-rebuild`）が唯一の手段。まだ本番データが無い今のうちに済ませた。
同じ理由で、**後から付けられない CHECK を伴う列はこの1回でまとめて足した**。

| 列 | 置くもの |
| --- | --- |
| `service` | `'line'` を追加。自社注文も同じ表に並べ、画面と日次売上を1本に保つ |
| `order_source` | `'external'`（既存3サービス経由）/ `'line_direct'`（自社受注）。既定 `'external'` |
| `delivery_provider` | `'service'` / `'store'` / `'uber_direct'` / `'wolt_drive'`。未確定は NULL |
| `delivery_tracking_id` | 委託先が払い出す追跡ID。お客様への追跡案内と失敗時の照会に使う |
| `delivery_fee_amount` | 委託先へ実際に払った配送実費（円、0以上）。「サービスの取り分35%想定」と比べる材料 |
| `coupon_id` | 自動適用したクーポン。金額の内訳を後から説明できるようにする |
| `friend_id` | 注文したお客様（友だち）。注文後のタグ付け・ステップ配信を繋ぐ |

食い違いを表の側で止める CHECK を2本入れた:

- 外部サービス経由の注文に委託配送は付かない（`order_source='external'` なら `delivery_provider` は NULL / `service` / `store` のみ）
- `order_source='line_direct'` なら `service='line'`

索引は 635 の3本を作り直し、2本足した:

- `rt_delivery_orders_store_source_received(store_id, order_source, received_at)` — 経路ごとの件数・売上を店舗別に引く
- `rt_delivery_orders_friend_received(friend_id, received_at) WHERE friend_id IS NOT NULL` — 「このお客様の注文履歴」。外部注文は索引に入れない

TypeScript 側は `apps/worker/src/services/delivery-order-source.ts`（新規）に
`DELIVERY_ORDER_SOURCES` / `DeliveryOrderSource` / `isDeliveryOrderSource` を置き、移行の CHECK と並びを揃えた。
`restaurant-delivery.ts` に足さず別ファイルにしたのは、あのファイルが行数の上限（`code-size-baseline.json`）に
達しているため。上限を引き上げない方針なので、新しい値は小さいファイルへ分ける。

**お客様データ削除との関係（`friend_id` を足した結果）。**
`friend_id` が入ったことで、この表は「お客様の個人データ削除で行ごと消す表」になる
（`apps/worker/src/services/customer-data-relations.json` に登録。`customer-data-deletion.test.ts` が登録漏れを落とす）。
つまり**削除依頼を受けたお客様の注文行は売上履歴からも消える**。
既存の作法と同じで、`bookings`（消える）と `booking_payments`（`retain` + 保護関係で残す）のように、
売上側を残したい場合は**個人に紐づかない別の記録**を用意するのが repo の答え。
フェーズ2で日次売上をお客様削除に耐えさせる必要が出たら、注文行に依存せず、
個人を特定しない集計行（または `retain` の精算表）を足す。今回はその表をまだ作らない。

### 3. 配送業者の差し替え口 — `apps/worker/src/services/delivery-dispatch-provider.ts`

通信を1行も書かない、型と選び方だけの口。**Uber Direct → Wolt Drive を「実装を足すだけ」で増やせる**ようにした。

- `DeliveryDispatchProvider`：`id` と `quote` / `create` / `cancel`。**例外を投げず**、
  `DeliveryDispatchResult`（`ok:true` / `kind:'unavailable'` / `kind:'error'`）で返す。
  `kind:'error'` の中身は既存の `SafeExternalDeliveryError`（`external-delivery-retry.ts`）で、
  **業者の生の文面や本文は持たない**（分類済みのコードだけ）という既存の作法に合わせた。
- `createDeliveryDispatchRegistry(providers)`：登録順がそのまま既定の優先順。同じ業者の二重登録は**作る時点で**止める。
  知らない業者は例外ではなく `null`。
- `selectDeliveryDispatchQuote(quotes, {nowSec, priority})`：期限切れを外し、**安い → 早い → 優先順**で選ぶ。
  使えるものが無ければ `null`（呼び出し側が代替手段や返金へ進む）。

**商売上の閾値は口の中に入れていない。** 「1,200円未満は自社配送にしない」などは
`rt_store_feature_flags.config_json` から呼び出し側が読んで渡す。店舗ごとに変えられる値を
コードに埋めないため。

試験は `apps/worker/src/services/delivery-dispatch-provider.test.ts`（13件）。

## フェーズ2で何をどこへ足すか

| フェーズ2の中身 | 足す先 |
| --- | --- |
| LIFF の注文画面・リッチメニューの入口 | **新規UI → 先に新しい Pencil ファイルを作って利用者の承認を取る**。承認前に実装しない |
| 自社注文の受け取り | `rt_delivery_orders` に `service='line'` / `order_source='line_direct'` で書く。表の変更は不要 |
| Uber Direct 連携 | `DeliveryDispatchProvider` を実装した `uber-direct-dispatch.ts` を1本足して registry に登録 |
| Wolt Drive 連携 | 同じく1本足すだけ。`selectDeliveryDispatchQuote` は変更不要 |
| 配達員の状況通知（Webhook） | **新しい表**。`rt_delivery_events` は既存3サービスの重複排除台帳なので混ぜない（下記） |
| 自社配送に回すかの判定 | `rt_store_feature_flags.config_json` の閾値を読み、`selectDeliveryDispatchQuote` に渡す |
| 手配できなかったときの代替・返金 | `selectDeliveryDispatchQuote` が `null`、または `kind:'unavailable'` を受けた分岐。Stripe 側は別途 |
| 注文後のタグ付け・ステップ配信 | `rt_delivery_orders.friend_id` を起点にする |
| 店舗ごとの入り切り画面（運用コンソール） | **新規UI → Pencil 承認が必要**。保存先は `rt_store_feature_flags` で足りる |
| 切った店舗の見え方（サイドメニューを隠す・リッチメニューの枠を隠す・LIFF直アクセスに案内文） | 既存画面の表示条件。判定は `rt_store_feature_flags` |

**注意（利用者の指定）**：最低注文金額で画面側の注文を止めない。金額による振り分けは裏側だけで行う。

## 今回あえて足さなかったもの

- **`rt_delivery_events.service` に `'line'` を足さない。**
  あの表は「外部サービスの通知を二重に取り込まないための台帳」で、`UNIQUE (service, external_event_id)` が本体。
  自社注文は Webhook で来ないので入れる相手がいない。フェーズ2の配達員状況通知は**別の新しい表**にする。
  すでに行が入っている表を作り直さずに済ませる判断でもある。
- **お届け先の住所・お客様の連絡先の列。**
  個人情報の保存期間の分類（`data-retention-tables.json`）を先に決める話であり、推測で足さない。
  現在の受信口の型（`delivery-webhook-payload.ts` の `WebhookOrder`）にも住所・連絡先・クーポンの項目が無く、
  外部サービス経由では埋める材料が無い。フェーズ2で自社注文の設計と一緒に決める。
- **閾値の既定値そのもの。** `config_json` の置き場だけ用意し、値はフェーズ2で入れる。

## 後片付けが要る周辺

- `docs/patent-briefing-delivery-aggregation.md` の表の案（`restaurant_id` / `platform_order_id` /
  `platform_source` / `platform_store_id`）は、実際の 635・683 の作りと**一致していない**。
  実装の正本はこの文書と移行ファイル。あの文書は由来の確認が済んでいないため今回は触っていない。
- `packages/db/schema.sql` は移行と同期していない（`rt_delivery_orders` が無い）。
  最終形の正本は `packages/db/bootstrap.sql` で、**生成物なので手で書き換えない**。
  移行を足したら `cd packages/db && node ./scripts/generate-bootstrap.mjs` で作り直す（今回も実施済み、移行数 580）。
- 新しい表は `packages/db/src/data-retention-tables.json` で分類が必須。
  `rt_store_feature_flags` は `purge`（親 `rt_stores.id`）に分類した。分類漏れは
  `data-retention-tables.test.ts` が落として知らせる。
