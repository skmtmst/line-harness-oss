# 提案E：店ごとの媒体リンク（2026-10-07）

飲食店の管理APIです。`account_id`と店舗の権限が必要です。

| 口 | 入力 | 返り値 |
| --- | --- | --- |
| `GET /api/restaurant-test/media` | アカウント選択 | `code, name, acceptsReservations`の配列 |
| `POST /api/restaurant-test/media` | `code: gourmet_*`, `name` | 予約を受けない媒体（`acceptsReservations: false`） |
| `GET /api/restaurant-test/media-links` | `storeId` | 媒体ごとの`pageUrl, loginUrl, closeOnBooking, version` |
| `PUT /api/restaurant-test/media-links/:code` | `storeId, pageUrl, loginUrl, closeOnBooking, expectedVersion` | 保存したURLと次の`version` |
| `POST /api/restaurant-test/reservation-link` | `storeId` | 固定の`url`、貼り付け用`html`、`available: false` |
| `GET /api/restaurant-test/channel-close-tasks` | `storeId` | 閉鎖・閉鎖済み・再開のタスク。予約通知は`reservationId`を持ち、`slotId/remainingSeats`はnull |
| `POST /api/restaurant-test/channel-close-tasks/:id/done` | タスクID | `status: done`。再開済みは409 |

URLはHTTPSのみ。空欄はnullで消します。URL内のID・パスワードを拒否します。新規設定は版0、古い版の保存は409。媒体作成・URL設定はowner/admin、閲覧・閉鎖報告は担当者も可。

LINE・電話の予約が入ると、店が選んだ予約媒体だけに閉鎖通知を作ります。在庫枠が未設定でも動きます。媒体ごとの「閉じた」を保持し、取消・終了・日時変更では元の日時の受付を「もう開けてよい」にします。通知先は当日の責任者、未設定なら店長です。責任者LINE未接続の場合も管理画面のタスクは残します。自動送信にはmanual印を付けません。

在庫自動調整は初期設定でオフ。既に明示的に設定された自動調整は保持します。予約URLの発行にはHTTPSの`LIFF_URL`が必要です。飲食店の顧客向けページは別作業のため、URLを配布する前に画面の完成を確認してください。

マイグレーション草稿：595。保存期限は店舗に従う削除対象です。
