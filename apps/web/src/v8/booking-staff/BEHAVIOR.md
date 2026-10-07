# 予約スタッフの画面の動き（BEHAVIOR.md）

対象：
- `staff-new.tsx` … 予約スタッフを登録（★V8 `CcA4k`）。入口 `app/booking/staff/new/page.tsx`
- `shifts.tsx` … 勤務とシフト（管理者 `d5fmnM`）・自分の勤務（本人 `E3YDK`）・ひも付けなし（`wvGke`）。入口 `app/booking/staff/shifts/page.tsx`
- `phone.tsx` … 右の列の「お客さまの予約画面」の見本（LIFF ②担当・③日時）

今までの V8（`app/booking/staff/new/staff-new-v8.tsx`・`app/booking/staff/shifts/staff-detail-v8.tsx`・`app/booking/menus/liff-phone-v8.tsx`）から動きを写し、見た目だけを絵どおりに組み直した。
v7 の画面（`theme !== 'v8'`）は今までどおり。

## 受け付ける URL と指定
- `/booking/staff/new`：指定なし。
- `/booking/staff/shifts?staff_id=<予約スタッフID>`：その担当者の勤務とシフト。
- `/booking/staff/shifts`（指定なし）：本人（役割 staff）は自分の予約スタッフを探して `?staff_id=` へ移る。管理者は予約設定の「受付枠」タブ（`/booking/menus?tab=hours`）へ移る。

## 役割
- サーバーの `/api/staff/me` の `role` で決める（手元の `lh_staff_role` は読めなかったときだけ使う）。今まではこの画面だけ手元の保存値を見ていた。
- 本人（staff）は `bookingApi.listMyStaff` で自分の予約スタッフだけを読む。ほかの人の `staff_id` を開くと「自分の勤務だけを表示できます」と自分の勤務への入口を出す。
- 変える権限（`booking.staff.own`）が無い人：入力は止め、保存・足す・作る・外す・ごみ箱のボタンは置かない（押せない形で出さない）。閲覧のみの帯を出す。
- 予約スタッフの登録は `booking.settings` の権限が要る。無い人には権限の案内だけを出す。

## 予約スタッフを登録（CcA4k）
- 読む：`bookingApi.listMenus`（担当メニューの候補）・`api.staff.list`（ログインユーザー）・`bookingApi.listStaff`（右の見本の担当）。メニューとログインユーザーは、失敗と0件を言い分け、再読み込みの口を出す。入力は消さない。
- 登録：`parseBookingStaffInput` で確かめ → `bookingApi.createStaff` → `bookingApi.putStaffMenus`（選んだメニューを is_offered）。割当だけ失敗したら作ったIDを控え、ボタンが「割当をやり直す」になる（スタッフを二重に作らない・R310）。成功したら担当スタッフの一覧へ。
- 名前欄は離れたときに直し方を出す。担当メニューが0だと登録しない。
- 未保存の離脱確認（`useUnsavedGuard`）。
- メニューのチェックは1行に4つまで並べ、残りは「ほかのメニュー（n）」で開く（絵は4つ）。メニューの時間・料金は名前に重ねると出る。
- 「店舗の営業時間に合わせる」は今までどおり常にオン（押せない）。予約枠の色は列がまだ無いので現在値だけ。
- 右の見本：登録中のスタッフも混ぜる。指名なしの枠に入る担当が1人でもいれば、先頭に「指名なし」を選んだ形で出す。

## 勤務とシフト・自分の勤務（d5fmnM・E3YDK）
- 読む：担当者（管理者は `listStaff`、本人は `listMyStaff`）・`getSettings`（時間帯・お店の休み・定休）・`listMenus`（見本のメニュー）・`listExceptions`（担当者の休み）→ `getAvailabilityRules`・`getShifts`・`getBreaks`・`getBreakDates`・`getGoogleCalendar` → `getAvailability`（今日から14日・この担当者）。
- 管理者は設定が読めないと失敗の画面（再読み込みの口）。本人は設定が読めなくても自分の勤務は見られる。
- いつもの勤務時間：曜日ごとのオン・オフと時刻。保存は週全体の置き換え（`putAvailabilityRules`）。
- 休憩：同じ時刻の曜日を1行にまとめて出す（例：月〜金）。曜日の言葉を押すと7つのチェックで曜日を選べる。保存のときは曜日ごとの行に広げて版付きで置き換え（`putBreaks`）。409 のときは最新に描き直す。
- この日だけ：担当者の休み（例外日 `createException`/`deleteException`・要 `booking.settings`）・この日のシフト（`putShifts`/`deleteShift`・札を押すと時刻を直せる）・この日の休憩（`putBreakDates`・版付き）を日付順に1列。消すときは確認の窓。
- 何週分かのシフトを作る：`generateShifts`（すでにある日は残す）。いつもの勤務時間が空なら作らない。
- Google カレンダー：`putGoogleCalendar`（503・422 は専用の文）・外すときは確認の窓（`deleteGoogleCalendar`）。
- 右の見本：空きのある最初の日から5日を並べ、その日の時刻を出す。休みの日は、予約枠の返事の `closed_dates` とお店の休み・定休から出す。下に14日の見取り（○×休）。

## ひも付けなし（wvGke）
- 本人の予約スタッフが見つからないとき。2つの読み方がどちらも通信失敗なら「無い」とは言わず、再読み込みの口を出す（R579）。
- 今までは「店の受付枠を見られる人」をそのまま受付枠へ移していた。いまは案内を出し、見られる人にだけ「店の受付枠を見る」の入口を足す（ひも付いていないことが分かるように）。

## 撮影（確かめ方）
- `E3YDK`：`/api/staff/me` を role staff で返す（`{"api":{"match":"GET /api/staff/me","body":{"success":true,"data":{…,"role":"staff"}}}}`）。
- `wvGke`：役割 staff ＋ 予約スタッフ0件。`"match":"GET staff/me"` で両方の口（`/api/staff/me` と `/api/booking/admin/staff/me`）に `{"success":true,"data":{…,"role":"staff"},"staff":[]}` を返す。
