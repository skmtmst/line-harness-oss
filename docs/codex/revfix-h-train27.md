# revfix-h / 列車27（2026-10-12）

作業場所: `~/lh-work/lh-train-27`、ブランチ: `codex/kenta-train-27-1012`。
開始時の本線: `867abaa39b1b8138cbb5b0e39f515127fe712a71`。
全試験前に取り込んだ本線: `217c31ba2a8a26aad31124ce6781b54902b5b4e0`。
本物の決済・LINE・メール・Google Calendarには接続せず、SQLite・人工応答だけで試験。
push・PR・D1更新・配備・migration追加は行わない。

## 再現と修正

- P1: `booking-payments.test.ts` の `REV-H1` 2件は、修正前にwebhook／cron双方でリマインダ0件（期待2件）になった。確定保存と回収記録を同じbatchにし、自動確定・決済・回収が `runConfirmedBookingSideEffects` を通る。
- P2: `booking-liff-create-idempotency.test.ts` の `REV-H2` は、支払いINSERTをSQLite triggerで失敗させても201（期待500）だった。予約・資源・支払いを1つのbatchにし、失敗時に予約も枠も残さない。旧版の支払い欠落は期限後に回収する。
- LIFF: `booking-response-generation.test.tsx` の `REV-H2` は、支払い必須なのに記録なしでも完了へ進んだ。通常予約・待ちからの予約とも不完全な成功を拒む。配備用Worker入口はLIFFと同じ実装を使う。
- 仲間: 前払い代理予約にも201の誤成功と、支払い前の確定リマインダ登録を再現。支払いをbatchへ移し、未確定時に確定処理を走らせない。
- 仲間: Google受理後の応答消失・予定ID確保直後の中断を再現。回収は同じ操作の予定IDを使い、重複応答を受理済みとして回収する。
- 旧版の不完全な成功応答が保存済みの再送も、支払い記録がなければ500にする。

## 確定入口の点検表

| 場所 | 確定後の処理・保存失敗の扱い | 結果 |
|---|---|---|
| `routes/booking.ts` LIFF新規・人のキャンセル待ち承諾 | 同じ新規予約口。予約＋資源＋支払い＋確定回収記録をbatch保存 | P1/P2修正、再現試験通過 |
| `routes/booking-payments.ts` webhook・支払い状態読込 | 決済反映→共通確定処理。確定と回収記録をbatch保存 | P1修正、重複・再読込試験通過 |
| `services/booking-payment-recovery.ts` / `booking-expirer.ts` | 支払い済みrequested・確定後の未完了工程・支払い記録欠落を回収 | P1/P2修正、中断・期限試験通過 |
| `routes/booking.ts` 管理画面の承認 | 状態更新＋回収記録をbatch、同じ共通確定処理 | 共通化、条件付き更新を保持 |
| `routes/booking.ts` 管理画面の代理登録 | 確定時だけ共通確定処理。前払いは支払い済みまでrequested | 仲間2件を再現・修正 |
| `routes/booking.ts` 管理画面・本人の日時変更 | 新規確定にはしない。変更版ごとのリマインダ更新・Google再同期・changed通知を既存batchとキーで実行 | 保存失敗を成功にするcatchなし。既存試験で検査 |
| `routes/booking.ts` 来店／無断の取り消し | completed/no_showから元のconfirmedへ戻す。新しい確定通知は不要 | 新規確定と区別、既存試験で検査 |
| `routes/events.ts` 新規・承認・日時変更・イベント待ち承諾 | イベント専用リマインダ・通知・自動化の入口あり。イベントの副処理catchあり（予約・支払い保存の握りつぶしではない） | 呼出しの抜けを点検、イベント既存試験で検査 |
| `services/event-booking-actions.ts` / `event-booking-action.ts` 自動処理からの申込 | イベント専用のリマインダ／登録処理。処理記録による再開を使う | salon確定処理とは別の入口。既存試験で検査 |
| `routes/restaurant-customer-booking.ts` / `restaurant-test.ts` 新規・承認・変更・外部取込 | 予約変更と同じDB triggerで出来事・消費者の記録を作り、restaurant-events/followupで回収 | 別の席予約の仕組み。保存失敗を成功にするcatchなし、既存試験で検査 |
| `routes/booking.ts` 席のキャンセル待ち承諾 | rt_reservations INSERTと待ち変換をbatch、同じ席予約の出来事triggerを通る | 既存試験で検査 |
| `routes/calendar.ts` / `packages/db/src/calendar.ts` 外部カレンダー予約 | salonのbookingsではなくcalendar_bookings。予定を作ったあとの記録口。保存失敗は500 | 別機能として点検、既存試験で検査 |

「入口あり」は今回の2指摘と同じ呼出し抜け／重要な保存失敗の誤成功の点検結果。イベント・席予約のすべての外部副処理に対する途中中断を、新規に総当たりで注入したという意味ではない。

## 二度送らないことの試験

`services/booking-confirmed-effects.test.ts`:
- `REV-H1/B-248: 別のDB接続のwebhookと回収でも確定メッセージを一度だけ送る`
- `REV-H1/B-248: webhookと回収が重なっても確定通知・自動化・成果・リマインダを一度だけ`
- `REV-H1/B-248: 通知受理後に完了保存が落ちても再送せず、残りの処理を回収する`
- `REV-H1/B-248: 送信の到達不明を次の回収でも自動再送しない`
- `REV-H1: 通知準備前の中断は次の回収で続行し、送信開始済みは繰り返さない`

LINEは送信開始直前に到達不明を記録する。送信や完了保存の結果が不明なら自動再送せず、人の確認待ちに残す。送信前の準備中断は、処理中の記録の貸出期限（10分）が切れた後の回収で再開できる。成功した工程は繰り返さず、失敗したDB工程と自動化の冪等な入口だけ再開する。
旧版で既に確定済みで回収記録のない予約には、新規通知を自動で追加しない（過去の到達が不明なため）。

## 時計

2026-10-12 00:09 JST = 2026-10-11 15:09 UTC。
2026-10-12 08:59 JST = 2026-10-11 23:59 UTC。
両時刻で確定しても「翌日の予約の前日09:00 JST」は2026-10-12 00:00 UTCに登録する試験を通した。

## 検証

- 最終検証は `NEXT_PUBLIC_API_URL=https://nen-line-stg.skmtmst.workers.dev`、Vitestは `--maxWorkers=4 --minWorkers=1`、重い作業は順番に実行。再試験の起動が一度重なったため自分の全体試験を停止し、順番実行に戻して全体を再検査した。
- 全体試験: shared 382、DB 2,269、update-engine 160、create-line-harness 52、SDK 53、MCP 68、LIFF 467、Worker 11,330、web 12,573、docs 6、root/scripts 968件が合格。既存のスキップ31件・todo1件は変更していない。
- Worker 967ファイル、web 2,155ファイル。初回の旧試験期待値・簡易DBの未対応を更新し、Worker全体を再実行して合格。共通確定処理への配線の試験も維持した。
- monorepo全体の型検査、scripts型検査、web lint、entity picker検査、共有部品の所有検査、bootstrap一致、migration方針検査、sharedのAsia/Bangkok再試験が合格。
- monorepo全体のビルド（Worker配備用LIFF・独立LIFF・web・docs・各package）、web設計値検査が合格。
- CIと同じブラウザ命令がすべて合格: Webhook runtime、revfix-c LIFF bundle、media permissions、EC issue685、LINE通知、archived tags、form submissions。人工APIを使い、外部送信・DB変更はしていない。
- ポート衝突を避けるローカル設定では、ブラウザ試験本体にも同じBASEを渡す。メディアの初回はBASE指定漏れで接続拒否になったが、設定を揃え、コード変更なしで全件合格した。
- V8 screen guardはCIの差分選択上、今回の対象外（apps/web・packages/shared・visual-qaの製品コード変更なし）。設計値検査とCIのブラウザ命令は実行した。
- `git diff --check` は出力なし。コミット後にも `git diff --check origin/codex/development...HEAD` とクリーン状態を確認する。
- 新しいmigrationは0件。検証・本番D1への書込、push、PR、配備は0回。
