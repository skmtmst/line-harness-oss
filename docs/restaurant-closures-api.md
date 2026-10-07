# 飲食店の臨時休業・貸切：画面への引き継ぎ

- 対象：席・卓の予約。人の予約設定の休業日とは独立。
- 作業ブランチ：`codex/kenta-v8-api-8`（API-7の上）。migration `598_restaurant_closures.sql` は草稿。適用は司令塔が番号別承認後に行う。
- 検証の基準：API-7の `d15a2193ab` 上。着手時の本線 `c6e03a61ec170876b1b60f207d81da78333dc3ba` は取込済み。検証前の再取得で本線 `962a24a4a75af57a610613bfc18d62ab1849eb0b` との競合を検出。予約API・共有型の入口・DB生成物2件の解消について司令塔へ判断を依頼中（実際のmergeは未実行）。

| 口 | 入力・返すもの |
|---|---|
| GET `/api/restaurant-test/closures` | `account_id`、`storeId`、任意の`month=YYYY-MM`。月をまたぐ記録も含む |
| POST `/api/restaurant-test/closures/preview` | 作成と同じ入力。重なる予約、待機件数、重なる休業の一覧。保存・通知・待機処理なし |
| POST `/api/restaurant-test/closures` | 保存した記録とpreviewと同じ影響。既存予約は取り消さない |
| PATCH `/api/restaurant-test/closures/:id` | 入力全体と`expectedVersion`。版の競合は409 |
| DELETE `/api/restaurant-test/closures/:id` | JSON `{expectedVersion}`。履歴へ移し、媒体ごとに「開けてよい」を作る |
| GET `/api/restaurant-test/availability` | `account_id`、`storeId`、`startsAt`、`endsAt`、`guestCount`。空き卓 |
| GET `/api/liff/booking/seat-availability` | `liffId`、`store_id`、`starts_at`、`ends_at`、`guest_count`と本人のBearer。空き卓。管理の休業メモは公開しない |
| POST `/api/restaurant-test/google/hours/from-closure` | `account_id`、`closureId`、`expectedVersion`、任意の`includePrivateEvent`。既存Google変更案を返す |

共有型は `RestaurantClosureInput`、`RestaurantClosure`、`RestaurantClosurePreview`、`RestaurantClosureSaveResult`、`RestaurantSeatAvailability`。
管理側は `restaurantTestApi.closures / previewClosure / createClosure / updateClosure / deleteClosure / seatAvailability`、Googleは `restaurantGoogleApi.proposeClosureHours`、LIFFは既存の `api.seatAvailability` を使う。

入力の暦日・時刻は店舗のタイムゾーン。種類は `temporary_closed / private_event / maintenance / other`。`tableIds`は省略・空配列で全卓。複数日は各日の同じ時間帯を閉じる（最大366日）。終日なら時刻はnull、時間指定は開始より後の終了（終了のみ24:00可）。日跨ぎの時間帯は暦日ごとに分ける。

重複は、日時と卓の両方が重なると409 `closure_overlap`。相手はレスポンスの`conflicts`。終了ちょうどと次の開始ちょうどは重複しない。電話・ウォークイン・仮押さえの409 `closure_conflict`には理由を返し、強制登録はない。一部貸切は残った人数の合う卓で受付・待機できる。

`reservations/day`は `data.closures`、`inventory/day`は既存の配列を維持してトップレベルの `closures` を返す。各枠の `closedTableIds` と `freeSeats` に休業を反映し、占有中の卓との二重計上を避ける。帯はこの記録から出す。API-7の媒体作業の一覧には `reason=closure`、`closureId`、`closureVersion`、`closureKind`、開始・終了日・時刻・卓を追加。同じ「閉じた」の口で処理する。変更前の対象には再開作業、変更後には新しい閉鎖作業を残す。

予約への連絡は既存1対1チャット。previewの `friendId` と `isLineFriend` は店舗のフォロー中の友だちだけ。担当者の送信には `X-Line-Harness-Source: manual` を付ける。休業保存時に顧客への送信はしない。媒体作業の担当LINE通知は自動送信で、同ヘッダーは付けない。媒体の枠を自動調整・書き戻ししない。

Googleは保存済みプロフィールから案だけ作る。貸切は `includePrivateEvent=true` の明示が必要。一部卓と深夜営業をまたぐ時間指定は誤った全店変更を防ぐため409。深夜営業は既存のGoogle営業時間案で日ごとに確認する。Google本送信の承認・競合検査・書込スイッチは既存のまま。

| 権限 | 一覧・空き照会・日別台帳 | preview・作成・変更・削除 | Google案の公開 |
|---|---|---|---|
| owner/admin | 可（担当店舗の範囲内） | 可 | 既存の確認と書込スイッチが必要 |
| staff | 予約枠・在庫の閲覧権限 | 予約枠・在庫の編集権限 | 不可 |
| 閲覧のみ | 可 | 不可 | 不可 |
| LIFFの本人 | 自分の店舗の空き卓だけ | 不可 | 不可 |

保存期限の一覧：`rt_closures`（店舗の設定・メモ）、`rt_closure_close_tasks`（媒体ごとの作業）、`rt_closure_close_outbox`（通知の再試行）を統括退会後の削除対象に分類。期限は既存の共通日数。通常の削除はarchiveで、在籍中の履歴は残す。退会後は子から親の順に消す。

残り：本線との4ファイルの競合解消・再検証、司令塔による画面の接続、migration番号別承認・D1適用、PR番号の反映履歴への追記と統合・検証配備。

検証：休業・貸切のHTTP/DB/LIFF/通知の15試験、Google変更案の既存21＋追加4試験、OpenAPI14試験。空き卓の除外とDB新規予約ゲートをそれぞれ外した変異は、いずれも該当試験が失敗することを確認し、元に戻した。Worker・管理画面・LIFFの型検査、Workerビルド、保存期限の10試験、スクリプトの672試験を確認。全Worker試験は840ファイル・9784試験が合格、既存の30試験はskip。その後の一部貸切のLIFF満席判定は、追加1試験を含む関連17試験で再確認した。
