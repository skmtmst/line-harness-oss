# 予約サイト・グルメ媒体（V8）の動き

入口：`app/settings/booking-media/page.tsx`（新しい画面なので V8 だけ）。絵：提案 E-4 `aSmph`（V8.pen の eGrSP）。
飲食店向け（テスト）が使えない環境（`NEXT_PUBLIC_RESTAURANT_TEST_ENABLED` が true でない）では統括へ戻す。

## 入口
- 設定の中のメニュー（`components/layout/settings-inner-nav.tsx`・`app/settings/settings-nav-v8.tsx`）の末尾「予約サイト・グルメ媒体」。飲食店向け（テスト）が使える環境だけ出す。
- 今日のお店（E-1）の右の列「予約サイト・グルメ媒体」の［設定へ］。
- この画面は絵に設定の中のメニューが無いので出さない（`useHideSettingsNav`、SNS 連携と同じ）。

## 受け付ける URL と指定
- `/settings/booking-media`（指定なし）。店舗は store-context で選んでいる店 → 無ければ先頭。店が2つ以上なら板の頭に店舗の選び（絵に無いが、店ごとの設定なので要る）。

## 口
- 読む：`GET /api/restaurant-test/media-links?storeId`（媒体ごとの pageUrl・loginUrl・closeOnBooking・version）、`GET /api/restaurant-test/channels?storeId`（予約メールの取り込みの状態）。
- 保存：`PUT /api/restaurant-test/media-links/:code`（storeId・pageUrl・loginUrl・closeOnBooking・expectedVersion）。変えた媒体だけを順に送る。
- 媒体を足す：`POST /api/restaurant-test/media`（code は `gourmet_` ＋時刻、name）。予約を受けない媒体として足す。
- 予約ページ：`POST /api/restaurant-test/reservation-link`（owner・admin だけ）。

## 表（つないでいる媒体）
- 列：媒体（頭文字の印＋名前）・店舗ページの URL・管理画面（ログイン）の URL（https:// を省いて ↗、新しいタブ）・予約メールの取り込み・「…」。
- 取り込みの札：グルメ媒体（予約を受けない）＝取り込まない／Google＝Google ビジネスと連携／受け取り中＝取り込み中／N日届いていない＝N日届いていません／ほか＝未設定。
- 「…」（管理できる人だけ）：URL を変える（窓。https だけ・ID とパスワード入りは断る・空は消す）／枠を閉じる知らせの対象にする・外す（予約を受ける媒体だけ）／店舗ページを開く／管理画面を開く。
- 変えた所は下の帯の［保存する］で保存。［キャンセル］は保存前の状態へ戻す。変えた数を帯の左に出す。

## LINE 予約を他のサイトに貼る
- 予約ページの URL と貼り付けるコードを出す。口が `available: false` を返すあいだは、［コピー］［コードをコピー］を押すと「LINE 予約のページは、まだ使えません」の案内を出し、コピーしない（「準備中」とは書かない）。
- お客さま向けの URL の設定が無い（503）ときは、その旨を出す。担当者（staff）には「管理者が確かめられます」の案内だけ。

## 他のサイトの枠を閉じる知らせ
- 帯：席の数（在庫）の自動調整はしない。LINE・電話の予約で他のサイトの同じ時刻の枠を閉じる知らせを出す。
- 切り替え「LINE・電話で予約が入ったら…知らせを出す」：予約を受ける媒体の closeOnBooking をまとめてオン・オフ（1つずつは表の「…」）。下の説明に重ねると対象の媒体名が出る。
- 「キャンセルで席が空いたら『もう開けてよい』を知らせる」：`GET/PUT /api/restaurant-test/close-notification-settings`（storeId・notifyReopen・recipientMode・membershipIds・expectedVersion）。オフは LINE の知らせだけ止める（管理画面の「もう開けてよい」は残る）。
- 知らせる相手：値の箱を押すと窓（当日の責任者（いなければ店長）／店長／スタッフを選ぶ）。選ぶときは、この店の担当で有効な人（snapshot の memberships）を1人以上。LINE とつないでいない人には注を出す。見え方は「店長」・「名前・名前（N人）」。
- 切り替え・相手は下の帯の［保存する］で媒体の変更と一緒に保存する（帯の左に「知らせの設定」）。409 は同じ「読み直す」の帯。

## 失敗・権限
- 保存の 409：「ほかの人が先に変えました」の帯と［読み直す］。400：https の URL だけ保存できる旨。途中まで保存できた行があるので、入力は残す。
- 閲覧のみ（owner・admin 以外）：媒体を足す・「…」・下の帯（キャンセル・保存）・切り替えを置かない。切り替えの代わりにオン・オフの札を出す。

## ほかの画面とのつなぎ
- 保存した URL は `v8/restaurant/dashboard/use-store-today.ts` の `loadStoreMedia` が受け取りの一覧に重ね、今日のお店の右の列（店舗ページ ↗・管理画面 ↗）と、枠を閉じる知らせ（ダッシュボードの帯・一覧）の［管理画面を開く ↗］に使う。

## 今の口で出せないもの
- 予約ページ（お客さま向け）の公開（口が available:false）。
