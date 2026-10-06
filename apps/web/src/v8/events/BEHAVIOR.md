# イベント予約（V8）の動き

入口：`app/events/new/page.tsx`・`app/events/change-review/page.tsx`・`app/events/bookings/page.tsx`（V8 のときだけ `src/v8/events/*.tsx`）。v7 の画面・試験は触らない。

| 画面 | ファイル | 絵 |
|---|---|---|
| イベントを作る | `create.tsx`（見本の窓 `application-preview.tsx`） | `d4adD4` |
| 変更の確認 | `change-review.tsx`（処理 `change-review-model.ts`） | `hmr2P`・確かめる窓 `qUdNh` |
| 申込者 | `bookings.tsx` | `Mu8qW` |
| 共通の値・日時 | `shared.ts` | — |

## 受け付ける URL と指定（今と同じ）
- `/events/new`：新しく作る。`/events/new?id=<イベント>&step=…`（今の作りの続きの段）は、V8 では作り終えたイベントとして `/events/edit?id=` へ移る（V8 は1枚で作り終えるので段が無い）
- `/events/change-review?id=<イベント>`
- `/events/bookings?id=<イベント>`

## 呼ぶ口（今と同じ）
- 作る：`eventsApi.createEvent` → `eventsApi.createSlots`（最初の枠。再送で二重にしない固定キー `first-slot:<id>`）。見本は `eventsApi.applicationPreview`
- 変更の確認：`eventsApi.getEvent`・`listSlots`・`previewEventChange`・`applyEventChange`（期待版・理由・二重送信よけの鍵つき）
- 申込者：`eventsApi.getEvent`・`listOccurrenceSelector`・`getOccurrenceApplicants`・`decideBooking`・`adminCancelBooking`・`updateBooking`（参加済・無断）・`promoteOccurrenceWaitlist`・`reorderOccurrenceWaitlist`・`skipOccurrenceWaitlist`・`downloadOccurrenceApplicantsCsv`・`previewOccurrenceBroadcast` → `api.broadcasts.send`

## 権限
- 作る・変更の確認は統括と管理者（Worker の requireRole('owner','admin')）。それ以外の人には作る画面で案内だけを出し、押せないボタンは置かない
- 申込者の「お知らせを送る」は統括と管理者だけ（役割は `/api/staff/me` から読む）。承認・断る・キャンセル・参加済・無断は担当者も

## 今の作りと違うところ
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
