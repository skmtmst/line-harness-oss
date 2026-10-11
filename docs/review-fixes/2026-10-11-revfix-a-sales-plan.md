# SCALE-05 予約売上の改善案（承認待ち・DB変更なし）

対象本線: `9e0c5edd8b30a014eac9eacbb3c3014699672cf3`。API-01の日本時間境界修正後に、手元の人工SQLiteだけで確認した。実環境の速度不足を断定する試験ではない。

## 確かめたこと

`getBookingSalesSummary` は現在期間と前期間の予約・入金明細を取得し、JavaScriptで合計・メニュー・曜日を組み立てる。人工の確定予約1,000件では、JSへ返る明細も1,000件。結果は予約1,000件・売上1,000,000円だった。問い合わせ計画は `idx_bookings_v298_account_status_starts` の `line_account_id` 部分だけを利用した。statusを限定しない集計なので、現在の索引では期間で十分に絞れない。

## 改善の順序

1. 予約と入金を別々にSQLで集約する。予約の件数・確定件数・売上・取消/拒否件数・無断件数を `SUM(CASE WHEN ...)` で求める。入金は `booking_payments.status='paid'` と **paid_atの期間**で数える。予約の開始日へ入金期間をすり替えない。
2. 合計・メニュー別・曜日別の小さな集約結果だけをWorkerへ返す。率の分母、予約時料金の優先、削除されたメニューの扱いを今の契約どおり保つ。全期間と前期間は同じSQL部品を使う。
3. 曜日は店の `booking_settings.timezone` に従う。Asia/Tokyo固定のSQLで他の店の契約を変えない。任意のIANAタイムゾーンはSQLiteの固定offsetでは表せないため、指定期間のタイムゾーン境界をWorkerで作ってDBへ渡す方法を先に検証する。集計結果の比較試験を通してから切り替える。
4. API-01の修正後は `julianday(...)` で時差付きの保存値を比較するので、次の **式索引** が候補になる。既存の文字列索引だけを追加して解決したことにはしない。

```sql
-- 案のみ。採番・migration作成・DB適用は行っていない。
CREATE INDEX idx_bookings_account_start_instant
  ON bookings(line_account_id, julianday(starts_at));
CREATE INDEX idx_booking_payments_account_paid_instant
  ON booking_payments(line_account_id, julianday(paid_at))
  WHERE status = 'paid';
```

表を作り直す必要はない。索引が増えると予約・入金の書き込み時の負担とDBサイズも増えるので、既存索引との重複を確認する。作成前にオーナーへ番号と中身を提示し、承認後にだけmigrationを作る。

## 受け入れ条件の案

- 現在/前期間、月初・単日のJST00:30、閏日、取消・拒否・無断、削除済みメニュー、予約料金のスナップショット、入金日が予約日と違う例を今の集計と照合する。
- 店のタイムゾーンが日本以外でも曜日が一致する。
- 1千・1万・10万件の人工データでも、Workerへ返る行は期間内明細数ではなく、メニュー数と曜日数に比例する。
- EXPLAIN QUERY PLANでaccountと期間の式索引が使われることを確認する。実環境のSLOは別途合意し、今回の手元の数を実環境の保証にしない。

REM3-04の補足: アプリの未設定/不正値の既定は10分へ修正した。既に明示保存された時間は変更していない。既存のmigration 558には `hold_minutes DEFAULT 30` がある。DBの既定もそろえるなら、既存migrationを書き換えず、将来の承認済みmigrationで既定変更を検討する。今回は新しいmigrationを作っていない。
