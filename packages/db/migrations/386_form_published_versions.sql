-- N-166: 公開中の回答フォームと、編集途中の下書きを分離する。
-- 公開URL・回答処理は current_published_version_id の不変版だけを読む。

ALTER TABLE forms ADD COLUMN current_published_version_id TEXT;

CREATE TABLE form_versions (
  id                             TEXT PRIMARY KEY,
  form_id                        TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version_number                 INTEGER NOT NULL CHECK (version_number >= 1),
  source_content_revision        INTEGER NOT NULL CHECK (source_content_revision >= 1),
  name                           TEXT NOT NULL,
  description                    TEXT,
  fields                         TEXT NOT NULL DEFAULT '[]',
  layout                         TEXT,
  on_submit_tag_id               TEXT,
  on_submit_scenario_id          TEXT,
  on_submit_message_type         TEXT CHECK (on_submit_message_type IN ('text', 'flex')),
  on_submit_message_content      TEXT,
  on_submit_webhook_url          TEXT,
  on_submit_webhook_headers      TEXT,
  on_submit_webhook_fail_message TEXT,
  save_to_metadata               INTEGER NOT NULL CHECK (save_to_metadata IN (0, 1)),
  og_title                       TEXT,
  og_description                 TEXT,
  og_image_url                   TEXT,
  status                         TEXT NOT NULL DEFAULT 'published' CHECK (status = 'published'),
  published_at                   TEXT NOT NULL,
  created_at                     TEXT NOT NULL,
  UNIQUE (form_id, version_number),
  UNIQUE (form_id, source_content_revision)
);

CREATE INDEX idx_form_versions_form_number
  ON form_versions(form_id, version_number DESC);

-- 既存互換の「作成と同時に受付中」は、最初から公開版も一緒に作る。
-- 管理画面の /drafts は is_active=0 なので、このトリガの対象外。
CREATE TRIGGER trg_forms_initial_published_version
AFTER INSERT ON forms
WHEN NEW.status = 'active' AND NEW.is_active = 1
BEGIN INSERT INTO form_versions (id, form_id, version_number, source_content_revision, name, description, fields, layout, on_submit_tag_id, on_submit_scenario_id, on_submit_message_type, on_submit_message_content, on_submit_webhook_url, on_submit_webhook_headers, on_submit_webhook_fail_message, save_to_metadata, og_title, og_description, og_image_url, status, published_at, created_at) VALUES ('form-version-v1-' || NEW.id, NEW.id, 1, NEW.content_revision, NEW.name, NEW.description, NEW.fields, NEW.layout, NEW.on_submit_tag_id, NEW.on_submit_scenario_id, NEW.on_submit_message_type, NEW.on_submit_message_content, NEW.on_submit_webhook_url, NEW.on_submit_webhook_headers, NEW.on_submit_webhook_fail_message, NEW.save_to_metadata, NEW.og_title, NEW.og_description, NEW.og_image_url, 'published', NEW.updated_at, NEW.updated_at); UPDATE forms SET current_published_version_id = 'form-version-v1-' || NEW.id WHERE id = NEW.id; END;

-- 移行時点で受付中のフォームを、その瞬間の公開版として固定する。
INSERT INTO form_versions (
  id, form_id, version_number, source_content_revision,
  name, description, fields, layout,
  on_submit_tag_id, on_submit_scenario_id,
  on_submit_message_type, on_submit_message_content,
  on_submit_webhook_url, on_submit_webhook_headers, on_submit_webhook_fail_message,
  save_to_metadata, og_title, og_description, og_image_url,
  status, published_at, created_at
)
SELECT
  'form-version-v1-' || id, id, 1, content_revision,
  name, description, fields, layout,
  on_submit_tag_id, on_submit_scenario_id,
  on_submit_message_type, on_submit_message_content,
  on_submit_webhook_url, on_submit_webhook_headers, on_submit_webhook_fail_message,
  save_to_metadata, og_title, og_description, og_image_url,
  'published', updated_at, updated_at
FROM forms
WHERE status = 'active' AND is_active = 1;

UPDATE forms
SET current_published_version_id = 'form-version-v1-' || id
WHERE status = 'active' AND is_active = 1;

-- 公開済みの中身は直接更新・削除しない。変更は新しい版を作る。
CREATE TRIGGER trg_form_versions_immutable
BEFORE UPDATE ON form_versions
BEGIN SELECT RAISE(ABORT, 'published form versions are immutable'); END;

CREATE TRIGGER trg_form_versions_no_delete
BEFORE DELETE ON form_versions
BEGIN SELECT RAISE(ABORT, 'published form versions cannot be deleted'); END;

-- 別フォームの版を現在版として差し込めないようにする。
CREATE TRIGGER trg_forms_published_version_ownership_insert
BEFORE INSERT ON forms
WHEN NEW.current_published_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM form_versions
   WHERE id = NEW.current_published_version_id AND form_id = NEW.id
 )
BEGIN SELECT RAISE(ABORT, 'published version belongs to another form'); END;

CREATE TRIGGER trg_forms_published_version_ownership_update
BEFORE UPDATE OF current_published_version_id ON forms
WHEN NEW.current_published_version_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM form_versions
   WHERE id = NEW.current_published_version_id AND form_id = NEW.id
 )
BEGIN SELECT RAISE(ABORT, 'published version belongs to another form'); END;

CREATE TRIGGER trg_forms_activation_requires_published_version
BEFORE UPDATE OF is_active ON forms
WHEN NEW.is_active = 1 AND NEW.current_published_version_id IS NULL
BEGIN SELECT RAISE(ABORT, 'form publish is required before activation'); END;

ALTER TABLE form_submissions ADD COLUMN form_version_id TEXT REFERENCES form_versions(id);

CREATE INDEX idx_form_submissions_version
  ON form_submissions(form_version_id)
  WHERE form_version_id IS NOT NULL;
