# V8 飲食店予約 API（booking）

正本：V8 HTML l9NlC0 / rm92Y / Y8SjT2 / qf3ky / MJoJR / bSp4h / BERxg。基準 HEAD: 22cf0869f2d62dccd18f606a25ec314927de7fe5。#1451 の統合へ干渉しないため、この枝のローカルコミットのみ。push・PR・CI・実環境DB更新はしない。

共通：`/api/restaurant-test`、認証必須、飲食店機能パックと統括・選択店舗・LINEアカウントの閲覧範囲を検査。読取と予約入力は owner/admin/staff、設定・承認は owner/admin。閲覧専用は書込不可。JSON は `{success:true,data}`、入力400、権限403、見つからない404、重複・古い版409。個人情報・秘密値をエラーに含めない。

| 絵・機能 | 入力（prefix以下） | 出力・失敗時の扱い |
| --- | --- | --- |
| l9NlC0 / rm92Y 仮押さえ | POST `/reservations/holds`：storeId、startsAt、endsAt、guestCount、tableId（省略時は空き卓を自動選択）、holdMinutes（1〜120）、note。PATCH `/reservations/:id`：status=cancelled/confirmed | 予約id・卓id・holdExpiresAt。pending+期限を仮押さえとする。満席409。期限切れは読取・予約書込の前と定期処理でcancelledへ変更。取消履歴を残す。期限切れの確定409。仮押さえはLINEを送らない。 |
| l9NlC0 日付取得 | GET `/reservations/day?storeId&date=YYYY-MM-DD` | 店のタイムゾーンで当日と重なる全予約・押さえ（件数上限による取得漏れなし）。date・予約配列。 |
| rm92Y 来店履歴 | GET `/customers/history?storeId&phone` または `lineUid`（両方ならUID優先）、GET `/customers/search?storeId&q` | 同じ店舗の本人のvisitedだけのvisitCount・直近20件。名前一致だけで同一人物にしない。検索は同店舗の予約＋その店舗LINEの友だち。 |
| rm92Y 電話予約・確認 | POST `/reservations/manual`：既存入力＋source=phone、notifyLine | id・卓id・lineNotice（送信済み/送れなかった理由）。確認LINEには店舗・店舗時間での開始／終了日時・人数・コース（未指定は席のみ）を記載する。日をまたぐ場合も終了日を明記する。予約保存は送信失敗で取り消さない。通知は自動送信なのでmanualヘッダーなし。 |
| Y8SjT2 営業時間・枠生成 | GET/PUT `/opening-hours`（既存）：storeId、hours（7曜日・複数時間帯）、expectedVersion。POST `/inventory/generate`：storeId、date、expectedHoursVersion、媒体別配分 | 店舗時間で30分刻みの枠を作る。既存枠は保持。夜越え対応。営業時間版の競合409。 |
| Y8SjT2 / qf3ky 在庫 | GET `/inventory/day?storeId&date`、PUT `/inventory/:id`（既存）：otaCapacity/lineCapacity/walkInCapacity、expectedVersion。PUT `/inventory/allocation`：storeId、slots[{id,expectedVersion}]、媒体別配分 | 版・更新者・更新日時・予約人数・占有席・占有卓・空き席。全枠配分は一括・原子的に保存。古い版は409で最新情報を返す。画面は編集開始時の版を保持して比較する。 |
| MJoJR 価格承認 | PATCH `/menu/:id`（既存）：price、effectiveAt（開始日時）。PATCH `/approvals/:id`（既存） | approvalId/requestId/pendingPrice。申請中は現行価格維持。承認後かつ開始日時到来で適用。二重申請・基準価格の変更409。申請中/承認済み開始待ちを画面表示。 |
| bSp4h ログイン連携 | PUT `/memberships/:id/login`：staffId（既存ログインメンバーid、nullで解除） | 同統括のログインメンバーとの対応を保存。名簿に実際の役割・状態・範囲・版を返す。権限変更は既存 `/api/staff/:id` の再認証・最終管理者保護・版検査を必ず通す。ownerの昇格は行わない。対応した名簿は実際のログイン役割・店舗範囲に同期。未連携の名簿は従来どおり。 |
| BERxg 卓配置 | PATCH `/tables/:id`（既存）：floorX/floorY（0〜10000整数）、joinGroup（nullで解除）、POST `/tables`も同じ項目。PUT `/tables/layout`：storeId、tables[{id,floorX,floorY,joinGroup}]（1〜200件） | 保存して再取得した座標・結合グループを使う。範囲外400。ドラッグと数値入力で保存。座標は配置順の列・行として描画し、狭い画面では折り返す。一括配置は全件の店舗所属を照合して原子的に更新し、別店舗混在404では一件も更新しない。 |

DB：567=仮押さえ期限・予約整合、568=在庫占有集計、569=価格の開始日時・ログインメンバー対応。既存546/547の仕組みは再利用する。新規表が必要になれば保存期限台帳も同時更新する。実環境適用は各番号のオーナー承認待ち。

検証：WorkerのHTTP試験（権限・別店舗・同時更新・期限・再送）、SQLiteのmigration/整合試験、V8の操作試験、shared/db/worker/webのtsc、git diff --check。1機能ごとにコミットし、反映履歴は `docs/release-log/unreleased/codex-v8-api-booking-codex.md` にPR番号なしで記す。
