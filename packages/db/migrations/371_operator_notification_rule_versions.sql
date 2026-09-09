-- N-327 (#663): 公開した運用者通知ルールの版を固定する。
--
-- 業務イベントの自動発火は、発火時点で公開されていた版の内容で送る。
-- ルールを更新しても、作り済みの通知インスタンス・送達行が指す版は変わらない。
-- notification_instances.definition_version_id / notification_deliveries.version
-- (migration 304 で作成済み)へ、発火時の版番号を写す。

ALTER TABLE notification_rules
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

-- 重複防止時間の境目をまたいで同じ業務イベントが再送されても、
-- 同じルールの通知インスタンスは1件だけにする。
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_notification_instance_source
  ON notification_instances(
    line_account_id,
    definition_id,
    source_event_type,
    source_event_id
  )
  WHERE audience_type = 'operator';
