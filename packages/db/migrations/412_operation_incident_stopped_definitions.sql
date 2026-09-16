-- N-451: 停止した瞬間の「止まった定義」の版・期限を incident へ保存し、
-- 復旧の前に 編集・削除・追加・権限喪失・期限切れ を検査するための列。
--
-- stopped_definitions_json: 停止時点で稼働対象だった定義の指紋一覧
--   (capability ごとの {id, version, expiresAt, status})。
-- restore_report_json: 直近の復旧試行が出した検査結果
--   (再開した対象・理由つきで止めた対象・下書きへ戻した期限切れ予約)。
ALTER TABLE operation_incidents
  ADD COLUMN stopped_definitions_json TEXT
  CHECK (stopped_definitions_json IS NULL OR json_valid(stopped_definitions_json));

ALTER TABLE operation_incidents
  ADD COLUMN restore_report_json TEXT
  CHECK (restore_report_json IS NULL OR json_valid(restore_report_json));
