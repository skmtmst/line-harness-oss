# 飲食の融合1・共通の予約盤の契約

2026-10-10 / B-181〜189・B-214 / PLAN 01・02・03・06・07。migration 626・627。適用・配備は司令塔が別工程で行う。

表示型の正本は `packages/shared/src/reservation-board.ts`。新しい予約表を作らず、人は bookings、席は rt_reservations に保存する。4つの入口（予約管理のカレンダー・予約管理の日／受付・飲食台帳・ダッシュボードの今日の予約）は共通部品 ReservationBoard に入力する。

## 読み取り

- 人: `GET /api/booking/admin/board?account_id=&from=&to=&limit=&offset=`。
- 席: `GET /api/restaurant-test/board?account_id=&storeId=&from=&to=&limit=&offset=`。店は既存の組織・店舗・アカウント権限を通す。
- 返事: `{success:true,data:{entries:ReservationBoardEntry[],total,limit,offset}}`。limit は最大500。印刷は offset を進めて total まで全ページを読む。
- `ReservationBoardEntry`: id, kind（people/seats）, scopeId, version, startsAt, endsAt, status, customerName, guestCount, resourceIds（スタッフ／使用する全卓）, resourceLabel, contactLabel（連絡先の伏せ字）, currentAllergy（今回の注意）, source, courseName, note, dining, holdExpiresAt。
- SQLiteのオフセット無し時刻はUTCとしてISO形式で返し、端末の時間帯で意味を変えない。人は期間と重なる予約、席は期間内に開始する予約を返す（既存の台帳の期間指定を維持）。
- 未取得は null、空き件数を推測して0にしない。古い席予約は代表 table_id を表示する。写しがない旧予約に現在の友だち情報を遡って補充しない。

## 変更と版

- 人: `PATCH /api/booking/admin/board/:id` に `{kind:'people',expectedVersion,startsAt,staffId?}`。既存の管理変更サービスへ lock_version として渡す。営業時間・資源・担当・メニュー・同時上限・通知と再試行は既存契約を保つ。
- 席: `PATCH /api/restaurant-test/reservations/:id` に `{expectedVersion,startsAt,endsAt,tableId,guestCount?}`。既存のその他の編集欄も同じ版を必須にする。
- 人の版は lock_version（初期値0）、席の版は customer_version（初期値1）。種類ごとの版をそのまま返し、0も有効な人の版として変更へ渡す。席は管理・LIFF・取込・来店・hold失効を含む意味のある全更新で進める。すでに版を進めるLIFF更新はさらに二重加算しない。
- 版確認と更新は同じSQLの WHERE 条件。失敗なら元の日時と卓を残す。盤は成功後に読み直す。古い版で自動的にやり直して上書きしない。
- 注意・来店の改版だけでは未送信の予約結果通知を落とさない。日時・人数・取消が変わった古い結果は無効にする。来店の確認リンクは飲食3で予約版に結ぶ。

## 状態・空き

状態は保存先の既存値を維持。席の pending/confirmed/seated/visited は占有、cancelled/no_show は非占有。pending の期限切れ hold は非占有。visited は来店であり退店ではない。実退店と回転は飲食2の628で追加し、予定終了を実退店時刻に置き換えない（D2）。

占有区間は `[startsAt,endsAt)`。終了時刻と次の開始が同じなら重ならない。有効な待ちの招待も全卓を占有する。停止・閉鎖した構成卓を含む結合は選べない。既存の代表卓を残し、1卓の容量を超える人数は同じ結合組の全卓を対応表へ登録する。結合組を人数に合わせて一部だけ切り取らない。空きの候補は同じ openSeatTables を使い、収容可能な最小容量順。競争する書込はDBの卓対応表の制約でも拒否する。在庫は人数と占有した全卓の席数を区別する。

LIFFは人数と日時を指定する。座席図・卓の指定・卓希望を出さない。来店時刻・退店時刻を過去の予定から推測しない。

## 座席図

`POST /api/restaurant-test/floors?account_id=` に `{storeId,name}`。新しい階・エリアを作る（owner/admin）。
`GET /api/restaurant-test/floors?account_id=&storeId=` → RestaurantFloor[]。
`PUT /api/restaurant-test/floors/:id?account_id=` → RestaurantFloorWrite（id,storeId,name,width,height,outline,fixtures,tables,expectedVersion）。

階の版更新と卓配置は同じD1 batch。版違い・別店舗の卓・重複ID・盤外・重なる卓は保存しない。失敗時に入力中の図を保つ。outline は点の列、fixtures は壁・入口・厨房・トイレ・窓の位置と寸法、tables はID・形・位置・寸法・向き。座席図は管理画面だけ。既存の卓の停止・結合・詳細の編集口は残す。旧配置・卓詳細の位置更新も盤外と卓の重なりを拒否する。位置指定なしの卓追加は空いている位置を選び、階の版更新と追加を同じbatchで確定する。

## 注意情報と権限

allergy/anniversary/seat_preference は friend_fixed_fields で既存の情報欄に結び、値・出どころ・更新時刻は friend_field_values に保存する。名前・型・状態・所属の変更は固定欄と同じ保護。フォームは固定欄の種類で対応する。

予約の dining は allergy,anniversary,seatPreference,courseId,courseAllergens,capturedAt の写し（コースの注意は登録された情報であり、安全の自動判定ではない）。店舗の LINEアカウントとUIDで友だちを確定する。電話番号で別アカウントの友だちを推測しない。未連携の人は予約の注意と既存の電話履歴を使い、恒久的な飲食専用顧客表を増やさない（D7）。アレルギーの安全性は自動判定せず店舗が確認する。

読取は既存のアカウント・組織・店舗の範囲。更新は owner/admin/staff、図面は owner/admin。閲覧のみはAPIで拒否し、画面でも編集・つまみ・保存を出さない。印刷には選んだ店・日付・経路・状態と読める予約だけを全ページから読み直して出す。時間・月・座席表の軸では同じ図も付け、一覧には予約時点と今回の注意を載せる。印刷は画面の高さ制限から外して複数ページへ流し、店・期間・絞り込みを見出しに残す。変更ボタンは出さず、印刷で送信を起動しない。

## 失敗

- 400/422: 入力誤り。`fields:{欄:理由}` を返して欄に表示。
- 403: 権限不足。別店のデータを返さない。
- 404: 存在しない・範囲外の予約／店舗。
- 409 version_conflict: 古い版。最新を読み込む操作を出す。
- 409 availability_conflict / 卓の競合: 重複、人数、停止、閉鎖。在庫・元の予約を変えない。
- 読取失敗は再読込、保存失敗は入力を保って知らせる。外部媒体に書き戻さない。

## 次の束への受け渡し

飲食2はこの全卓の占有・版を使い、628の実退店で全卓を解放する。飲食3の結果通知・来店回答は別物として扱う。飲食4のコース所要時間・フォームも同じ候補と版を使う。632のできごとのID・受取側完了・ジョブ取消条件は飲食2/3で追加する。ここでは未実装の送信を開始しない。
