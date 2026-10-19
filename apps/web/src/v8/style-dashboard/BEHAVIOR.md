> 文書：業種ダッシュボード（飲食・サロン・面談・教室）の動き｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 業種ダッシュボード（飲食・サロン・面談・教室）の動き

絵：V8.pen 修正案 DIHFx の列 XBkC2（NqAvL 飲食・mOAX5 サロン・R0FFqz 面談・k2MBw 教室／分析 KcRVI・hqQLV・UTxFu・tMIuZ／カレンダー UtmIg・R28Jqt／開いた状態 wFmQa・wXOm6）。決まり：B-294・B-304・B-305・B-309・B-318・B-319。

## 入口
- `/`（ホーム）：`GET /api/dashboard/style` で所属を確かめた業種を読み、4業種は業種ダッシュボード、標準・ECは共通ダッシュボードを出す。端末の古い業種を正本にせず、未取得・失敗は読込と再読込を出す。別アカウントの返事は使わない。標準ではEC・出荷を出さず、ECでは既存EC集計とT01の期間集計を組み合わせる。
- `/restaurant-test/dashboard`：飲食の業種ダッシュボード（前の「今日のお店」hKRRF を置き換え・B-319）。`?view=stores` は全店の一覧（CHz31・`restaurant/dashboard/stores.tsx`）のまま。

## 受け付ける URL と指定
- `?tab=`：`today`（1枚目・省略時）・`bookings`・`people`・`analytics`。
- `?view=`：`board`（盤）・`floor`（座席表・飲食だけ）・`list`（一覧）・`calendar`。省くと業種の初期（飲食・面談・教室は一覧、サロンは盤）。
- `?range=`：`week`・`month`（省くと今日）。カレンダーは 1か月なら月の形、ほかは週の形。
- 分析：`?sub=`（小タブ）・`?days=`（7・30・90）。

## 読む口（API 組4 `lib/api-styles.ts` の styleApi・API-CONTRACT-4。生の値は `adapter.ts` が画面の形 `model.ts` へ組み立てる）
- スタイル：`styleApi.get`（GET `/api/dashboard/style`）。読めないときはホームを前に読んだ表示（初めは標準）のまま。
- 数の帯・新着予約：`styleApi.summary`（metrics・previous・newBookings）。率は 0〜1 を %、null は「—」と理由（数が少ない・未設定）、0 は実測の 0。前との比べは previous から（無断率・取消率は下がると緑）。
- 盤・一覧・週／月：`styleApi.schedule`（columns・entries・days・closures・availability）。担当の候補は columns、空きは availability.slots、担当の休みは closures。飲食の盤は `axis=table`。
- 分析：`styleApi.analytics`（日数→ from/to。periodMetrics・daily・menus・staff・funnel）。前の期間の日ごとの値は返らないので、グラフはこの期間だけ。
- ［表示を変える］：`styleApi.get` の cards と版 → `saveCards`・`resetCards`（配列の順が上から下。接続の異常・媒体の知らせは隠せない）。
- ［休みを入れる］：飲食は既存の `restaurantTestApi.createClosure`（卓は tableIds）、ほかは `styleApi.closeHours` を担当 1 人ずつ（途中の失敗をまとめて成功にしない）。既存の予約は取り消さない。
- 教室の名簿：既存の `eventsApi.listBookings`（回＝slot_id）、出席は `eventsApi.updateBooking(status=attended)`。
- 飲食：口が読めないときは今の飲食の口から組み立てる（`restaurant-today.ts`）。異常の帯は今の「枠を閉じる知らせ」。
- 口が無い物（支払いの札・今日の入金・支払いのリンク・返金・お支払いのカード）は値を作らず、押すと共通の準備中の窓（`preparing-dialog.tsx`・B-314）。

## 操作
- 頭：［ウォークイン］（飲食だけ・今の窓）［LINE を送る］（一斉配信へ）［休みを入れる］［表示を変える］［主ボタン］（飲食＝電話予約の引き出し、サロン・面談＝予約を入れる、教室＝イベント予約へ）。
- 日付の段：［今日｜1週間｜1か月］・日付・担当（席・担当・講師）・比べる・更新時刻・［読み直す］。分析では［7日｜30日｜90日］・CSV・毎朝メール（口ができるまで理由つきで押せない）。
- 行：［来店］（飲食は `postSeatVisitMark`）・［取り消す］（`deleteSeatVisitMark`）・［Meet に入る］［場所を開く］（URL があるとき）。「…」は業種ごとの並び。支払いのリンク・返金は Stripe をつなぐまで理由つきで押せない（B-305）。
- 盤：予約の箱を押すと同じ並びの操作。空き（＋入れる）を押すと予約を入れる。今の時刻に赤い線。
- 教室：回を押すと右に名簿（出席・この回の人に LINE・支払いのリンク・休講にする）。
- 異常の帯の［閉じた］は `completeChannelCloseTask`（飲食）。

## 印・確かめの窓（B-338）
- ［無断にする］（面談は［欠席にする］）は開始の時刻を過ぎた予約にだけ出す（行の主ボタン［来店｜無断］と「…」の両方）。あとで戻せる。飲食は `postSeatVisitMark(no_show)`、人の予約は `bookingApi.postVisitMark(no_show)`、Meet は `styleApi.saveMeetResult(attendance=no_show)`。
- サロンの承認待ちは主ボタン［承認する］（`bookingApi.decideRequest(approve)`）。面談の実施済みで結果が無い物は［結果を付ける］（`saveBooking`・`saveMeetResult` の outcome）と「結果待ち」タブ（件数つき）。
- 教室の名簿は［出席｜欠席］（欠席は回が始まった後だけ）、7 人を超えたら［ほか N人を表示する］。
- 取り消す（h2lHCH）・返金（Y8MWGs、2 段）・休講（Md9O3）・休みの重なる予約（s8BwT8）は共通の確かめの窓（`components/shared/booking-confirm-dialogs.tsx`）。取り消しは理由を口へ。返金・休講・重なる予約への LINE は口が無いので、押すと共通の準備中の窓。
- 試験モードの印は `TestModeNote`（`bookingApi.getPaymentConfig().testMode`）。支払いの札の言葉は `payment-status.ts` の 1 か所。
- 閲覧のみは上に閲覧のみの帯、異常の帯は外の管理画面を開く物だけ残す。［表示を変える］に［型を変える］（`styleApi.save` の style）。

## 狭い板
- 白い板が 1100 未満では右の列を畳み、［新着・お支払いを見る］で開く（2 列で下に出す）。分析の右の列は下に並べる。日付の段は折り返す。数の帯は数と比べの札を折り返す（`KpiBand layout="link-row"`）。

## 閲覧のみ
- `useStaffRole` が owner・admin・staff 以外なら、頭の操作・行の［来店］・名簿の操作・右の列の送る操作を置かない。行の「…」は［詳細を開く］だけ。
