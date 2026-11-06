> 文書：店ごとの媒体リンクAPI｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# 店ごとの媒体リンクAPI

飲食店の管理APIです。`account_id`と店舗の権限が必要です。

| 口 | 入力 | 返り値 |
| --- | --- | --- |
| `GET /api/restaurant-test/media` | アカウント選択 | `code, name, acceptsReservations`の配列 |
| `POST /api/restaurant-test/media` | `code: gourmet_*`, `name` | 予約を受けない媒体（`acceptsReservations: false`） |
| `GET /api/restaurant-test/media-links` | `storeId` | 媒体ごとの`pageUrl, loginUrl, closeOnBooking, version` |
| `PUT /api/restaurant-test/media-links/:code` | `storeId, pageUrl, loginUrl, closeOnBooking, expectedVersion` | 保存したURLと次の`version` |
| `POST /api/restaurant-test/reservation-link` | `storeId` | 店舗のLINEアカウントのLIFF IDから作る`url`、貼り付け用`html`、`available: true` |
| `GET /api/restaurant-test/channel-close-tasks` | `storeId` | 閉鎖・閉鎖済み・再開のタスク。予約通知は`reservationId`を持ち、`slotId/remainingSeats`はnull |
| `POST /api/restaurant-test/channel-close-tasks/:id/done` | タスクID | `status: done`。再開済みは409 |

URLはHTTPSのみ。空欄はnullで消します。URL内のID・パスワードを拒否します。新規設定は版0、古い版の保存は409。媒体作成・URL設定はowner/admin、閲覧・閉鎖報告は担当者も可。

LINE・電話の予約が入ると、店が選んだ予約媒体だけに閉鎖通知を作ります。在庫枠が未設定でも動きます。媒体ごとの「閉じた」を保持し、取消・終了・日時変更では元の日時の受付を「もう開けてよい」にします。通知先は当日の責任者、未設定なら店長です。責任者LINE未接続の場合も管理画面のタスクは残します。自動送信にはmanual印を付けません。

在庫自動調整は初期設定でオフ。既に明示的に設定された自動調整は保持します。予約URLの発行には店舗の有効なLINEアカウントのLIFF IDが必要です。未設定・停止・保管済みは503です。[予約API](restaurant-booking.md)で確認してください。

保存期限は店舗に従います。DB更新は[更新手順](../migration-runbook.md)に従い、適用状況を確認します。
