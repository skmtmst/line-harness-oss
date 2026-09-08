-- 公開中のテンプレート送信文を版として固定する(#645 / 点検#497 N-131)。
--
-- これまでテンプレートの編集は message_type / message_content を直接書き換え、
-- 公開中の配信・自動応答・シナリオが参照する実送信文へ直ちに混入していた。
-- 以後は編集を draft_* 列(下書き)へだけ書き、公開操作で live 列へ写す。
-- 送信側(auto_reply / step_delivery / event_bus / reminder_delivery など)は
-- live 列を読み続けるので、公開版だけを参照する。参照先の id は変わらない。
ALTER TABLE templates ADD COLUMN published_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE templates ADD COLUMN published_at TEXT;
ALTER TABLE templates ADD COLUMN draft_message_type TEXT;
ALTER TABLE templates ADD COLUMN draft_message_content TEXT;
ALTER TABLE templates ADD COLUMN draft_carousel_actions_json TEXT;
ALTER TABLE templates ADD COLUMN draft_carousel_tap_limit_mode TEXT;
ALTER TABLE templates ADD COLUMN draft_carousel_tap_limit_text TEXT;
ALTER TABLE templates ADD COLUMN draft_question_json TEXT
  CHECK (draft_question_json IS NULL OR json_valid(draft_question_json));
ALTER TABLE templates ADD COLUMN draft_question_status TEXT
  CHECK (draft_question_status IS NULL OR draft_question_status IN ('draft', 'published'));
ALTER TABLE templates ADD COLUMN publish_idempotency_key TEXT;
-- 差し戻し対応(#645 6要件): 下書きの版。保存のたびに +1 し、公開で 0 に戻す。
-- 公開口はこの番号も確認し、検査後に別人が書き換えた下書きを出さない。
ALTER TABLE templates ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0;

-- 既存テンプレートは公開済みとして扱い、参照先なしを作らない。
-- 新規作成は未公開の下書きで始めるので、作った直後は送信候補に出さない。
UPDATE templates SET published_at = updated_at WHERE published_at IS NULL;
-- 移行時点で下書きが残っていた行は、全文スナップショットがあるものとして版1にする。
UPDATE templates SET draft_revision = 1 WHERE draft_revision = 0 AND (
  draft_message_type IS NOT NULL OR draft_message_content IS NOT NULL
  OR draft_carousel_actions_json IS NOT NULL OR draft_carousel_tap_limit_mode IS NOT NULL
  OR draft_carousel_tap_limit_text IS NOT NULL OR draft_question_json IS NOT NULL
  OR draft_question_status IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_publish_key ON templates (publish_idempotency_key);

-- 差し戻し対応(#645 要件5): 公開の確認キーの履歴。成功した公開は
-- 下書きなしの成功も含めて残し、後日の同キー再試行で別下書きを出さない。
-- 古い複数の成功キーもここに残る(最新1件だけの列では足りないため)。
CREATE TABLE IF NOT EXISTS template_publish_keys (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  published_version INTEGER NOT NULL,
  draft_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, idempotency_key)
);
