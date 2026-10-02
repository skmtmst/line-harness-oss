-- R345: 初回に送った本文（差し込み済み）を実行行へ保存する。
-- 同じ再試行キーでの再送は、保存した本文をそのまま送る。
-- まだ一度も送っていない行は NULL のまま、今までどおり最新の内容で作る。
ALTER TABLE reminder_delivery_runs ADD COLUMN sent_message_type TEXT;
ALTER TABLE reminder_delivery_runs ADD COLUMN sent_message_content TEXT;
ALTER TABLE reminder_delivery_runs ADD COLUMN sent_template_id TEXT;
ALTER TABLE reminder_delivery_runs ADD COLUMN sent_template_version INTEGER;
