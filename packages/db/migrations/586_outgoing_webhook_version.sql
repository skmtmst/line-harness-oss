-- 草稿：D1へは適用しない。582〜585は別の先行作業で使用済み。
-- 送り先の同時編集を防ぎ、更新した担当と日時を返す。
ALTER TABLE outgoing_webhooks ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE outgoing_webhooks ADD COLUMN updated_by_staff_id TEXT;

-- 自動停止・削除・復元など、編集口以外の設定変更も古い画面の保存を拒否する。
-- 通信結果の件数更新だけでは編集の版を変えない。
CREATE TRIGGER outgoing_webhook_config_version
AFTER UPDATE OF name, url, event_types, secret, secret_encrypted, is_active, max_retries, deleted_at
ON outgoing_webhooks
WHEN NEW.version = OLD.version
BEGIN
  UPDATE outgoing_webhooks SET version = OLD.version + 1, updated_by_staff_id = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') || '+09:00'
  WHERE id = NEW.id; END;
