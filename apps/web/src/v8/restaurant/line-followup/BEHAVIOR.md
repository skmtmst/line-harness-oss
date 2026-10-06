# LINE来店フォロー（V8）の動き

入口：`app/restaurant-test/line-followup/page.tsx`（V8 だけで出す。今までどおり）。絵：`xLpnS`。

## 受け付ける URL と指定
- `/restaurant-test/line-followup`：指定なし。

## 呼ぶ口（今の画面と同じ）
- snapshot の `lineFlows`（選んだ店舗のもの＋全店舗向け）。
- 下書きの保存：`restaurantTestApi.updateLineFlow(accountId, id, { title, body })`。保存しても送らない（確認用）。

## 表示
- 数：フロー数・予約24時間前／予約2時間前／来店後／口コミ依頼（あれば「確認用」、無ければ「未作成」）・本送信＝停止中（プレビューのみ）。絵の見出し「本送信（準備中）」は、画面に「準備中」を置かない決まりに合わせて「本送信」にした。
- 流れの種類は本物の `flow_type`（reservation_24h・reservation_2h・post_visit・review_request・member_card・one_tap_booking）で見る。
- 配信：`timing_minutes` が負なら「◯時間前」、正なら「◯時間後」、無ければ「常設」。
- 右の「LINEでの見え方」は入力中の題・本文をそのまま映す。アカウント名は店舗の LINE アカウント名。
- 閲覧のみには「下書きを保存する」を置かず、入力は読み取りだけ。
