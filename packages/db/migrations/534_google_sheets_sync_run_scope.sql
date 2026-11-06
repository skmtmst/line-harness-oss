-- d23c（監査 R437/R442）: Google Sheets 同期の実行記録に、どの出力先へ・
-- どの日本時間の日付の実行かを残す列を足す。
--
-- 出力先を切り替えたあとの記録がどのシートへの結果か分かるようにし、
-- 「1日1回（JST）」の定期同期がUTCの日付境界で同日に二度走らないよう
-- 判定用の日付列を持つ。
-- 付け足すだけ（既存の列・行は今の動き。旧行は両方 NULL のまま）。

ALTER TABLE google_sheets_sync_runs ADD COLUMN run_date TEXT;
ALTER TABLE google_sheets_sync_runs ADD COLUMN spreadsheet_id TEXT;
