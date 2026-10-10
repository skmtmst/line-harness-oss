# 飲食3：確認・フォロー・承認（2026-10-11）

API・DB・Workerのコミット用成果。画面の完成や配備の完了を表す報告ではない。

## 作業場所と採番

- ブランチ：`codex/kenta-rest3-1011`。作業場所：`~/lh-work/lh-pages-rest3`。
- 実装コミットSHA：`58708a35a9f12ad7281f206177f0c1188de71ccc`。報告書と反映履歴は別の文書コミット。
- 指定された列車17の開始SHA：`342e0dda60754e5a81b3f12c5cf43e54c20701bc`。
- テスト開始前に取得した本線SHA：`2243acead3f6facb965ccc2a1e1c6b0a6abaf68a`。依頼どおり本線は取り込んでいない。
- `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は合格。開始時に元の作業ツリーと専用作業ツリーはクリーン。
- origin本線・公開中PR・列車17・手元の枝を照合して630・631の空きを確認。del36bの予定634とは重ならない。
- **630_restaurant_confirmations.sql**：承認済み「前日の案内への返事」（計画629）の付け替え。
- **631_restaurant_scenario_source_jobs.sql**：承認済み「共通のシナリオで編集・承認した版で送る」（計画630）の付け替え。
- 再取得時に列車17には開始後の3コミット（CI待ち時間・画面・CI判別）があった。今回のAPI・DB変更と別領域であり、指定の開始SHAからの差分を保っている。
- 承認済みの4表だけを追加。未承認の口コミ対応表や列は作っていない。SQLの適用は行っていない。

## 作ったもの

店舗の本文を新しい専用欄へ保存せず、既存のscenarios・scenario_steps・scenario_versionsを使う。新しい店舗と既存店舗に共通シナリオと起点の対応を停止状態で用意する。既存の前日文はカードの本文へ移し、3つの返事ボタンを付ける。

起点は予約入り、予約24時間前、予約2時間前、実退店後のお礼、実退店後の口コミ、席待ちの招待。時刻と有効・無効の設定は本文と分ける。共通編集で行を追加・並べ替え・削除し、対応を追加・変更・解除できる。削除した行の対応は同時に外す。本文の組立・差し込み・計測リンク・Harness Proxyは共通経路を使う。

共通公開版と起点の版を開始申請に固定し、既存の飲食承認の承認後だけactiveになる。下書き・公開しただけ・申請中では送信0。本文、行、起点、公開版を変えた時点で停止し、旧申請は409になる。通常の友だち購読へ入れて全行を順番に送ることは禁止する。

予約ごとの仕事はできごと・公開版・行で一意。同じ友だちの2つの予約を混ぜない。送信直前にも所属、ブロック、停止、承認、公開版、予約の予定、実退店、待ちの期限を再確認する。失敗は同じretry keyで再試行する。受理済みログがあれば送信を増やさない。送信を試した仕事を新しい公開版・別のキーで作り直すこともしない。LINEの重複防止期間を超えた不明な仕事は再送しない。

新しい予約入りの固定通知は同一書込で無効にし、共通の行だけへ渡す。過去のイベントを補充せず、移行前の未送信の結果通知は残す。日時変更・取消の結果通知も残す。電話・直接来店も同じ予約入りの起点を使う。LIFFの仮押さえは送信せず、確定時のできごとで予約入りと確認を作る。

前日の返事はrequest_id・予約版・本人・アカウント・期限で受ける。「行きます」は予約を改版せず、「変更したい」は相談を記録する。「取消」は現行の自己取消期限を守り、予約取消・返事・結果通知を同じbatchで保存する。古い案内、別の本人、違う返事への変更は拒否する。同じ返事の再試行は一度の結果になる。

口コミ案内は評価の条件を持たず、同じ行を全員に送る。APIはLINEの依頼履歴と確認済み実口コミの対応を別に返す。実口コミの対応は未承認なので空配列であり、氏名・星・時刻から由来を推測しない。予約詳細は予約時のコースアレルゲンの写しと「登録された情報」の出どころを返し、安全判定はしない。

## APIの受け渡し（飲食4・画面担当）

管理APIは`/api/restaurant-test`。`account_id`または既存の組織指定、店舗の可視範囲を必須にする。閲覧のみの更新は403。以下の開始・停止・起点編集はowner/admin、読み取りはowner/admin/staff。

| 口 | 入力・出力 |
| --- | --- |
| GET `/followups/:storeId` | template・bindings・jobs・editor:`common_scenario`。scenario_idから既存の共通編集へ接続 |
| POST / PATCH `/followups/:storeId/bindings/:stepId` | expectedVersion（template_version）、trigger、offsetMinutes、enabled。POSTは共通の新しい行の対応も追加。別店の行は結べない |
| DELETE `/followups/:storeId/bindings/:stepId` | expectedVersion、trigger。行の対応を解除して停止 |
| POST `/followups/:storeId/request-start` | expectedVersion。公開済みで全ての有効な対応が公開行を参照すること。approvalId、pendingを返す |
| POST `/followups/:storeId/stop` | 即停止して版を進め、旧申請を無効にする |
| GET `/reservations/:id/confirmations` | request_id、reservation_version、response、requested_at、responded_at、expires_at、is_current |
| GET `/reservations/:id` | 共通ReservationBoardEntry、courseAllergens、allergensSource:`registered_at_booking` |
| GET `/followups/:storeId/review-history` | invitations、origin:`line_invitation`、reviewSelection:`all_customers`、verifiedGoogleReviewAttributions:[] |
| POST `/api/liff/restaurant/confirmations/:requestId/respond` | 検証済みLIFFの本人、expectedVersion、response:`going` / `change_requested` / `cancel` |

LINE postbackは`rc:<request UUID>:<response>`。既存の署名検証・アカウント判別・共通の再実行を通す。本人IDを本文から採用しない。取消後の結果通知と席待ちの処理は既存の口／定期処理へ渡す。

飲食4は予約を既存の保存口で確定・変更してcustomer_versionを進め、飲食2のイベントを作る。フォローを直接送ったり別の固定確認文を足したりしない。日時・人数の変更、取消、退店の訂正は古い仕事を無効にする。注意・来店だけの更新では予約結果通知を失わせない。前日カードを作った後の改版は古い返事を409にする。

差し込みは既存の共通情報に加え`var.reservation_datetime`、`reservation_end`、`guest_count`、`course_name`、`store_name`、`restaurant_going/change/cancel`、`waitlist_book_url/decline_url`。前日カードのボタンはこの予約別の値を使う。予約時刻はUTCに正規化し、表示は店の時間帯、共通の今日の差し込みは共通関数の日本時間を使う。

質問・条件分岐・タグ操作・シナリオアクションを含む公開版は開始申請で拒否する。予約別の質問状態を通常購読の状態へ流用しない。文・画像・カード・カルーセル・ボタン・フォームへのURLと差し込みは共通のメッセージとして扱う。席待ちは既存のretry keyを保つため、有効な招待行は1行に限定する。

新しい4表は保存期限の分類にも登録。仕事は公開版や友だちより先に削除する。友だち単独削除は新しい返事・仕事の外部キーを有効にした試験で確認し、他の友だちと店舗設定を残す。司令塔からdel36bへこの4表と新しい参照を引き継ぎ、統括削除の結合試験は合流後に行う。

## 試験・証拠

すべての試験・型検査・ビルドは`NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev`で実行（migration policyとbootstrap確認はローカルSQL検査）。証拠は`~/lh-work/design/v8/review/restaurant-rest3-1011/logs/`。

- 初回の全workspace試験と修正後のDB・Worker・残りのpackage全試験を合わせて全対象を実行。webは12,407件合格（1 skip・1 todo）、Workerは925ファイル・10,972件合格（30 skip）。その他のworkspace packageは6・53・357・160・418・52・68件合格。
- DB最終全試験は375ファイル・2,241件合格。全workspace型検査・ビルド、scripts全試験903件、bootstrap一致、migration policy（630・631）、git diff --checkは合格。
- 最終ログ：`tests-worker-final.log`、`tests-db-complete.log`、`typecheck-complete.log`、`build-final.log`。初回web等は`tests-all.log`、残りのpackageは`tests-backend-final.log`、scriptsは`scripts-all.log`。
- 下書き・申請中の送信0、承認後だけ送信、共通編集で停止、古い申請の拒否。
- 2予約・同時実行・再試行・応答喪失後の新しい承認版を含む二重送信防止。
- LIFFの確定・電話・直接来店・席待ちの期限とretry key、旧結果通知の保全。
- 本人、別アカウント、店舗の閲覧範囲、閲覧のみ、取消期限、返事の版ずれ。
- 00:09 JSTの時計で前日まで24時間、今日の差し込み、旧SQLiteのUTC時刻を確認。
- ブロック判定を外すmutationと、送信済みを再び実行対象にするmutationはそれぞれ対象試験がAssertionErrorで失敗。Vite transformでメモリ内だけ壊し、作業ファイルは壊していない。
- Workerの初回全試験では、今回追加した経路の権限一覧・OpenAPI・機能の目印・個人データ削除・旧固定送信の試験更新が8件失敗した。各対象を単独で再実行し、共通送信の承認と他の友だちの保全を確認する試験へ直したうえで、Worker全試験の再実行を合格させた。既存不具合として除外した失敗はない。
- 初回で新表の分類漏れと595再検証が失敗。分類を足し、595時点のtrigger構成で旧migrationを再検証するよう試験を修正した。旧migrationの履歴・参照・外部キー検査を全て維持し、単独再実行13件は合格。後続631の実データ移行・外部キーも別に検証した。

## 残り・操作していないもの

- **画面接続と1440/1152のmeasure・重ね合わせは未実施。** AGENTSとPLANの画面担当はClaude。Codexは画面・Pencil・保護されたV8要件を変更していない。フォローから共通編集、開始承認、返事、アレルゲンの表示を司令塔の画面担当へ渡す。
- **実際のGoogle口コミの「LINEから」札は未実装。** PLAN §2の636（確認済み対応）の承認がない。承認の中身を超える表・列は作らず停止。依頼履歴はこのAPIから表示できるが、実口コミの由来を断定する札とは別。
- 記念日の起点、常設の会員証・ワンタップ予約、系列店の案内は今回の予約起点の対象外。飲食4等が承認済みの契約でつなぐ。口コミ・フォームへのURLは共通編集で設定する。
- 反映履歴の`0000`・`#0000`は依頼どおりの仮番号。司令塔がPR採番後にファイル名と行の番号を置換する。
- push・PR・本線取り込み・D1適用・配備・実送信・外部サービスへのログインは一切行っていない。開発サーバーとPlaywrightも起動していない。
