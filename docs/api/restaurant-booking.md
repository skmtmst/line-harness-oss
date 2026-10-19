> 文書：飲食店の予約・休業API｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 飲食店の予約・休業API

管理の口は `/api/restaurant-test`。飲食店機能・店舗・LINEアカウント・担当範囲を確認します。読取と予約入力はowner/admin/staff、設定・承認はowner/admin、閲覧のみは書込不可です。呼び出しは `restaurantTestApi`、共有型は `packages/shared`、口の一覧はWorkerのOpenAPIを使います。

## 予約と設定

| 口 | 入力・動き |
| --- | --- |
| POST `/reservations/holds` | 店舗・開始/終了・人数・任意の卓・押さえ時間・メモ。期限切れの確定と満席は409。押さえだけではLINEを送らない |
| GET `/reservations/day` | `storeId,date`。店舗時間で当日と重なる全予約・押さえ・休業 |
| POST `/reservations/manual` | 電話予約は`source:phone`。`notifyLine`で確認LINE。保存は通知失敗でも取り消さない |
| GET `/customers/history`・`/customers/search` | 同店舗の電話かLINE UIDで検索。UID優先。氏名だけで本人と断定しない |
| GET/PUT `/opening-hours` | 7曜日の複数時間帯と`expectedVersion`。`lateArrivalPolicy`は分数1〜1440・文言1000文字まで。省略は保持、nullで解除 |
| POST `/inventory/generate` | 30分刻み。営業時間版と媒体別配分。既存枠を保ち、深夜営業にも対応 |
| GET `/inventory/day`・PUT `/inventory/:id`・`/inventory/allocation` | 占有・空き・媒体別配分。全枠変更は各版を照合して原子的に保存 |
| PATCH `/menu/:id`・`/approvals/:id` | 価格と適用開始日時。承認かつ時刻到来までは現行価格。二重申請・基準変更は409 |
| PUT `/memberships/:id/login` | 同統括のログインメンバーを`staffId`で結ぶ。nullで解除。権限変更は既存staffの再認証・最終管理者・版の検査を通す |
| PATCH `/tables/:id`・PUT `/tables/layout` | 座標は0〜10000の整数、結合グループ。全件の店舗所属を照合して一括保存。別店舗混在は全件拒否 |
| POST `/reservation-link` | 店舗の有効なLINEアカウントのLIFF IDから予約URLを発行。未設定・停止・保管済みは503 |

予約の `note` はUnicodeで200文字、`customerPhone` は50文字まで。確定で省略すると押さえの値を保持し、null・空欄で消します。確認LINEは店舗時間で終了日まで明記します。通知は自動送信です。

LIFFは `/api/liff/restaurant` の `link/:token`・`availability`・`holds`・`reservations`・`reservations/:id/confirm|cancel|reschedule` を使います。対象店舗のLINE Login IDトークンと本人の友だちIDで検証します。新規は新しい `requestId`、同じ再実行は同じ値、変更は読んだ数値版を渡します。

空きの `seatTypes`、予約の `seatType` を表示します。空きが無い理由は `temporary_closed/private_event/regular_closed/full`。内部の休業メモは公開しません。滞在時間は既定120分。受付期限、押さえ期限、席待ち、前日の深夜営業とLINE受付枠も空き判定へ含めます。通知は確定後に登録し、保存した送信キーで再試行します。

## 休業と貸切

| 口 | 使い方 |
| --- | --- |
| GET/POST `/closures`・PATCH/DELETE `/closures/:id` | 店舗・種類・日付・時間帯・卓。変更と削除は`expectedVersion`。通常の削除は履歴へ移す |
| POST `/closures/preview` | 保存前の影響だけ返す。編集は`excludeId`で自店の有効な対象を除外。予約・通知を変更しない |
| GET `/closures/:id/contact-status` | 連絡済み件数と予約ごとの状態。閲覧のみでも利用可 |
| GET `/availability` | `storeId,startsAt,endsAt,guestCount`。空き卓。LIFFの既存口は `/api/liff/booking/seat-availability` |
| POST `/google/hours/from-closure` | 保存済みプロフィールから変更案を作る。貸切は`includePrivateEvent:true`が必要 |
| GET/PUT `/close-notification-settings` | `storeId,notifyReopen,recipientMode,membershipIds,expectedVersion`。選択先は店舗名簿のmembership ID |

日付と時間は店舗のタイムゾーン。種類は `temporary_closed/private_event/maintenance/other`。卓を省略・空配列なら全卓、複数日は最大366日で同じ時間帯を閉じます。終日は時刻null。終了だけ24:00を使え、日跨ぎは暦日ごとに分けます。

日時と卓が重なる休業は409 `closure_overlap` と `data.conflicts` を返します。予約の409 `closure_conflict` には休業の理由を返し、強制登録はしません。既存予約は取り消しません。一部貸切は残りの卓で受付できます。在庫の休業と占有を二重に数えません。

連絡済みは、休業作成後に担当者が該当するフォロー中の友だちへ送信成功した記録で数えます。同予約は1件、同じ人の別予約は別件です。本文が休業案内かは判定しません。担当者の1対1返信には `X-Line-Harness-Source: manual` を付けます。自動通知には付けません。

`notifyMedia:false` は新しい媒体閉鎖作業を作らず、古い対象を再開へ移します。`notifyReopen:false` は再開LINEだけを止め、管理画面の作業は残します。宛先は当日の責任者・店長・選択した有効な担当者。送信直前に現在の設定を読み直し、古い宛先へ送りません。媒体へ在庫を書き戻しません。

Googleは案だけ作ります。一部卓や深夜営業をまたぐ時間指定は全店の誤変更を防ぐため409。本送信は既存の承認・競合・書込スイッチを通します。staffと閲覧のみはGoogle案を公開できません。
