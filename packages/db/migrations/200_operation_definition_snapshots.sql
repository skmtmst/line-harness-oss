-- 緊急停止時の配信定義を、本文や秘密値を持たないハッシュとして保存する。
-- 復旧前に現在定義と比較し、確認後に定義が変わった場合も復旧を止める。
ALTER TABLE operation_incidents ADD COLUMN definition_snapshot_json TEXT;
ALTER TABLE operation_incidents ADD COLUMN definition_snapshot_error TEXT;
ALTER TABLE operation_incidents ADD COLUMN restore_drift_json TEXT;

