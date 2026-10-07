# イベント予約（V8）の動き

入口：`app/events/page.tsx`・`app/events/new/page.tsx`・`app/events/change-review/page.tsx`・`app/events/bookings/page.tsx`（V8 のときだけ `src/v8/events/*.tsx`）。v7 の画面・試験は触らない。

| 画面 | ファイル | 絵 |
|---|---|---|
| 一覧 | `list.tsx`（目を向ける回の決め方 `attention.ts`） | `e2ekFu` |
| イベントを作る | `create.tsx`（見本の窓 `application-preview.tsx`） | `d4adD4` |
| 変更の確認 | `change-review.tsx`（処理 `change-review-model.ts`） | `hmr2P`・確かめる窓 `qUdNh` |
| 申込者 | `bookings.tsx` | `Mu8qW` |
| 共通の値・日時 | `shared.ts` | — |

## 受け付ける URL と指定（今と同じ）
- `/events`：一覧（絞り込み・並び・ページ・フォルダは画面の中だけで持つ。今と同じ）
- `/events/new`：新しく作る。`/events/new?id=<イベント>&step=…`（今の作りの続きの段）は、V8 では作り終えたイベントとして `/events/edit?id=` へ移る（V8 は1枚で作り終えるので段が無い）
- `/events/change-review?id=<イベント>`
- `/events/bookings?id=<イベント>`

## 呼ぶ口（今と同じ）
- 一覧：`GET /api/events/admin/events?page&limit&q&filter&sort&folderId`（数の帯は応答の summary）、承認待ちの数（filter=pending・limit=1）、`api.folders.list('event')`・フォルダの追加は共通の `FolderAddDialog`（kind=event）、名前の変更 `eventsApi.updateEvent`（版つき）、削除 `eventsApi.deleteEvent`
- 作る：`eventsApi.createEvent` → `eventsApi.createSlots`（最初の枠。再送で二重にしない固定キー `first-slot:<id>`）。見本は `eventsApi.applicationPreview`
- 変更の確認：`eventsApi.getEvent`・`listSlots`・`previewEventChange`・`applyEventChange`（期待版・理由・二重送信よけの鍵つき）
- 申込者：`eventsApi.getEvent`・`listOccurrenceSelector`・`getOccurrenceApplicants`・`decideBooking`・`adminCancelBooking`・`updateBooking`（参加済・無断）・`promoteOccurrenceWaitlist`・`reorderOccurrenceWaitlist`・`skipOccurrenceWaitlist`・`downloadOccurrenceApplicantsCsv`・`previewOccurrenceBroadcast` → `api.broadcasts.send`

## 権限
- 一覧の作る・名前の変更・削除・フォルダの追加は統括と管理者だけ。それ以外の人には「イベントを作る」を置かず場所だけ空け、見出しの下に閲覧のみの帯を出す
- 作る・変更の確認は統括と管理者（Worker の requireRole('owner','admin')）。それ以外の人には作る画面で案内だけを出し、押せないボタンは置かない
- 申込者の「お知らせを送る」は統括と管理者だけ（役割は `/api/staff/me` から読む）。承認・断る・キャンセル・参加済・無断は担当者も

## 今の作りと違うところ
- 一覧：行の名前の前にフォルダの色の丸（2026-10-07 オーナー）。行の右端は「…」（右クリックでも同じ一覧）。「…」に「日時・定員を変える」（変更の確認へ）を足した
- 一覧：並び（日付が近い順・イベント名順）と「満席のイベントだけ」は「よく使う絞り込み」から選ぶ（絵に並びの部品が無い）
- 一覧：開催日時の下の行は「次の回」（絵の「ほか N 回」は回の数を返す口が無い）。公開範囲がタグのときだけ状態の下にタグ名を出す
- 一覧：絵の「CSV で書き出す」は、イベント一覧を書き出す口が無いので置かない
- 作る：3段（概要・予約枠・公開設定）を1枚にした。「下書きを保存」は非公開で、「公開する」は公開で作る。最初の枠は日付・開始・終わり・定員を入れる（絵の「開始」の欄に終わりの時刻も並べた）
- 作る：絵の「申込ページの URL」は口が無い（申込ページの住所を決める欄が無い）ので、同じ場所に「オンラインの URL」（会場の URL・確定した人にだけ見せる）を置いた
- 作る：絵の「タグを付ける」は申し込んだ人にタグを付ける口が無いので置かない。「申込を受けたら LINE で知らせる」はいつも送るので、押せないチェックで見せる
- 作る：画像・詳細の中央寄せ・キャンセル期限・確認メッセージの追記・OG などは、作ったあと編集（`/events/edit`）で直す
- 変更の確認：「影響を確かめる」ボタンを置かず、日時・定員・受付を変えると 0.6 秒後に自動で確かめる（絵に確かめるボタンが無い）。古い問い合わせの返事は捨てる
- 変更の確認：会場・オンラインの URL を変える欄は、カードの下の「会場・オンラインの URL も変える」で開く（絵に無いが機能はある）
- 変更の確認：公開中のイベントは理由を書くまで「変えてお知らせする」を押せない（口が理由を求めるため）
- 変更の確認：送る文の見本は Worker の文（「イベントの内容が変更になりました。…」）の形で出す
- 申込者：数の帯は絵どおり4枚のカード（共通の KpiCard をカードの見せ方で並べる）
- 申込者：「キャンセル待ち N 番」は案内中も含めた並び順で数える
