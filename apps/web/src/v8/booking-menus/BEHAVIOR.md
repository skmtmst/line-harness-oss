# 予約設定（V8）の動き

入口（V8 のときだけ新しい画面。v7 はそのまま）：
- `app/booking/menus/page.tsx` → `src/v8/booking-menus/settings.tsx`（5タブ＋予約経路、右にお客さまの予約画面の写し）
- `app/booking/menus/new/page.tsx` → `src/v8/booking-menus/menu-form.tsx`（作る・直す・競合）
- `app/booking/menus/staff/page.tsx` → `src/v8/booking-menus/assign.tsx`（担当メニューをまとめて決める）

写し元：`app/booking/menus/settings-v8.tsx`・`settings-tabs/*`・`channels-tab-v8.tsx`・`liff-phone-v8.tsx`・`menu-version-history.tsx`・`new/menu-form-v8.tsx`・`staff/assign-v8.tsx`・`app/booking/staff/staff-edit-dialog.tsx` と、それらが読む `lib/*`（`src/v8` からは `@/app` を読めないので写した）。

絵：メニュー `owaS3`・1152 `P6EdLW`・閲覧のみ `C9fv7A`・受付枠 `yRPxl`・1152 `VFxWU`・休業日 `KRgTQ`・予約のルール `x1OZS6`・予約経路 `ZyDd6`・状態 `xCoDe`・作る `QqER7`・競合 `v5L19Z`・担当まとめ `ooufy`。

## 受け付ける URL と指定（今と同じ）
- `/booking/menus?tab=menus|hours|holidays|rules|staff|channels`（無い・知らない値はメニュー）
- `/booking/menus/new`（作る）・`/booking/menus/new?menu=<id>`（直す）
- `/booking/menus/staff`（`?menu_id=<id>` でその行に色を付ける）

## 呼ぶ口・保存先（今と同じ）
- メニュー：`bookingApi.listMenus`・`updateMenu`（並び替えは2件の sort_order を入れ替え）・`patchMenu`（公開／止める）・版の履歴
- 店の設定：`bookingApi.getSettings`・`saveSettings`（版つき、409 は読み直し）
- 設備：`listResources`・`createResource`・`updateResource`・`deleteResource`、空きの確かめ：`checkAvailability`
- 休業日：`createException`・`updateException`・`deleteException`、休みの日の予約数は `listRequests`
- 担当：`listStaff`・`createStaff`・`updateStaff`・`deleteStaff`・`getStaffMenus`・`putStaffMenus`・`listStaffMenusBulk`・`putStaffMenusBulk`（「指名なし」は全員の `is_designation_optional`）
- 作る・直す：`createMenu`・`updateMenu`・`saveMenuResources`・`listMenuVersions`・`revertMenuVersion`
- 予約経路：`/api/booking/admin/channels`・`conflicts`・`channels/settings`（自動割り当て）・`staff/:id/google-calendar`
- 右の写し：`getAvailability(menuId, from, to, applyStoreRules)`。お客さまの予約画面の写しなので、店舗のルール（休業日・受付の範囲）を当てた空きを読む（`apply_store_rules=1`。勤務とシフトの v7 のお客さまの見本と同じ口）

## 権限
- 変えられるかはサーバーの役割（`/api/staff/me`）で決める：オーナー・管理者は変えられる、担当者は項目キー（`/booking/menus`・`booking.settings`）を持つときだけ。答えが来るまでは今までどおり手元の判定（`canEditFeature`）。
- 閲覧のみの人：頭の下に「閲覧のみで見ています。変える操作は管理者に頼んでください。」の帯。作る・つまみ・下の保存帯は置かない（作るボタン・つまみは場所だけ空ける）。「…」は版の履歴が見られるので残す。

## 今の V8 と違うところ
- 頭：タブの下に余白（絵どおり）。閲覧のみの帯は各タブの中ではなく、頭の下に1本。
- メニュー表：名前の下に分類の札、その下に説明（1行 84px）。作るボタンは＋の印。
- 予約のルール：3つの決まりは数の入力ではなく選ぶ欄（`60 日先まで`・`3 時間前まで` など。保存済みの値が候補に無ければ候補に足す）。お知らせの時刻・当日・予約枠の間隔・仮押さえ・タイムゾーン・日時の最初の形は「ほかの設定」を開いて変える。前日の行は「前日の 18:00 に送ります／24時間前に送ります」と書く。
- 休業日：前後の月の日は空ける。数字は升の左上。「臨時休業を足す」は文字ボタン。休みの日の予約の注意は帯ではなく字だけ。
- 下の帯：受付枠・予約のルール・担当まとめ・作るは、キャンセルと保存を中央に置いた帯をいつも出す（変更が無いときに保存を押すと「変更はありません。」）。
- 右の写し：日付は5日（LIFF の週の並びと同じ）で、空きのある先頭の日から。担当は「指名なし」（全員の空きを合わせる）。メニューのカードは説明が無くても1行空ける。
- 予約経路のタブは右の写しを出さず全幅。
- 中身が短いタブでも、下の帯は板の下に置く（板の高さを画面いっぱいにする。絵 x1OZS6）。
- 作る：灰の段に「受け方」「予約を受けたときにすること」「使う設備」を白い小段で積み、その下にお支払い。付けるタグは打って絞れる1つ選び（「付けるタグ：〇〇」）。担当の札は3つ横に並べ、トリマーは名前だけ。
- 作る：タグの候補を、`lineAccountId` が無いタグもこのアカウントのものとして出す（一覧の口は `lineAccountId` を返さないので、前は全部はじかれて「使えるタグがありません」になっていた）。
- 担当まとめ：メニューは `sort_order` の順。読み込んだら上書きのある最初の升を選んでおく。「指名なし」「止めている」の印は名前の横（title にも）。
