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

-- 既存テンプレートは公開済みとして扱い、参照先なしを作らない。
-- 新規作成は live 列へ直接書くので、作った直後から送信側が読める。
UPDATE templates SET published_at = updated_at WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_templates_publish_key ON templates (publish_idempotency_key);
