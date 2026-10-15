# 業種ダッシュボード（飲食・サロン・面談・教室）の動き

絵：V8.pen 修正案 DIHFx の列 XBkC2（NqAvL 飲食・mOAX5 サロン・R0FFqz 面談・k2MBw 教室／分析 KcRVI・hqQLV・UTxFu・tMIuZ／カレンダー UtmIg・R28Jqt／開いた状態 wFmQa・wXOm6）。決まり：B-294・B-304・B-305・B-309・B-318・B-319。

## 入口
- `/`（ホーム）：使い方のスタイル（`GET /api/account-style`）が飲食・サロン・面談・教室なら業種ダッシュボード、それ以外（標準・EC・読めない）は今の標準のダッシュボード（`v8/dashboard`、変えない）。前に読んだスタイルを店ごとに覚え（`lh_usage_style:<アカウント>`）、次からは最初からその画面を出す。
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

## 狭い板
- 白い板が 1100 未満では右の列を畳み、［新着・お支払いを見る］で開く（2 列で下に出す）。分析の右の列は下に並べる。日付の段は折り返す。数の帯は数と比べの札を折り返す（`KpiBand layout="link-row"`）。

## 閲覧のみ
- `useStaffRole` が owner・admin・staff 以外なら、頭の操作・行の［来店］・名簿の操作・右の列の送る操作を置かない。行の「…」は［詳細を開く］だけ。
