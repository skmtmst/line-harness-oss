-- 回答と利用先があるフォームを物理削除せず、停止・保管できるようにする。
ALTER TABLE forms ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));
ALTER TABLE forms ADD COLUMN archived_at TEXT;
ALTER TABLE forms ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision >= 1);

CREATE INDEX idx_forms_status_updated
  ON forms(status, updated_at DESC);

-- 削除影響を確認したあとに回答や利用先が増えた場合、古い確認結果で
-- 実行できないようフォームの版を進める。
CREATE TRIGGER trg_forms_revision_submission_insert
AFTER INSERT ON form_submissions
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_submission_delete
AFTER DELETE ON form_submissions
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_submission_update
AFTER UPDATE OF form_id ON form_submissions
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_open_insert
AFTER INSERT ON form_opens
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_open_delete
AFTER DELETE ON form_opens
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_open_update
AFTER UPDATE OF form_id ON form_opens
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_account_insert
AFTER INSERT ON form_accounts
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_account_delete
AFTER DELETE ON form_accounts
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_account_update
AFTER UPDATE OF form_id, line_account_id ON form_accounts
WHEN OLD.form_id IS NOT NEW.form_id OR OLD.line_account_id IS NOT NEW.line_account_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_webinar_cta_insert
AFTER INSERT ON webinar_ctas
WHEN NEW.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_webinar_cta_delete
AFTER DELETE ON webinar_ctas
WHEN OLD.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_webinar_cta_update
AFTER UPDATE OF form_id ON webinar_ctas
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;

CREATE TRIGGER trg_forms_revision_rich_menu_insert
AFTER INSERT ON rich_menu_areas
WHEN NEW.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = NEW.form_id; END;

CREATE TRIGGER trg_forms_revision_rich_menu_delete
AFTER DELETE ON rich_menu_areas
WHEN OLD.form_id IS NOT NULL
BEGIN UPDATE forms SET revision = revision + 1 WHERE id = OLD.form_id; END;

CREATE TRIGGER trg_forms_revision_rich_menu_update
AFTER UPDATE OF form_id ON rich_menu_areas
WHEN OLD.form_id IS NOT NEW.form_id
BEGIN UPDATE forms SET revision = revision + 1 WHERE id IN (OLD.form_id, NEW.form_id); END;
