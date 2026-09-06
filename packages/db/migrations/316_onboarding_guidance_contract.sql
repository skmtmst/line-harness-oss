-- migration-policy: table-rebuild
-- V6 機能34: 順路・マニュアル正本表・レシピ複製の実データ契約。

ALTER TABLE manual_links ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version > 0);
ALTER TABLE manual_links ADD COLUMN last_http_status INTEGER;

CREATE TABLE manual_link_check_history (
  id          TEXT PRIMARY KEY,
  link_key    TEXT NOT NULL REFERENCES manual_links(key) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'broken')),
  http_status INTEGER,
  error_code  TEXT,
  checked_by  TEXT,
  checked_at  TEXT NOT NULL
);

CREATE INDEX idx_manual_link_check_history_v316_key_time
  ON manual_link_check_history(link_key, checked_at DESC);

-- 既存 run の状態名を、要件 §11-1 の共通語へそろえる。
-- recipe_clone_items が親を参照するため、親子を同時に作り直す。
CREATE TABLE recipe_clone_runs_next (
  id                  TEXT PRIMARY KEY,
  recipe_id           TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  recipe_version      INTEGER NOT NULL,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name_prefix         TEXT,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'succeeded', 'failed', 'rolled_back')),
  idempotency_key     TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_count       INTEGER NOT NULL DEFAULT 0,
  failure_reason      TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  finished_at         TEXT,
  UNIQUE (line_account_id, idempotency_key)
);

INSERT INTO recipe_clone_runs_next (
  id, recipe_id, recipe_version, line_account_id, name_prefix, status,
  idempotency_key, request_fingerprint, created_count, failure_reason,
  created_by, created_at, finished_at
)
SELECT
  id, recipe_id, recipe_version, line_account_id, name_prefix,
  CASE WHEN status = 'running' THEN 'queued' ELSE status END,
  idempotency_key, '', created_count, failure_reason,
  created_by, created_at, finished_at
FROM recipe_clone_runs;

CREATE TABLE recipe_clone_items_next (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES recipe_clone_runs_next(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO recipe_clone_items_next (id, run_id, kind, target_id, name, created_at)
SELECT id, run_id, kind, target_id, name, created_at
FROM recipe_clone_items;

DROP TABLE recipe_clone_items;
DROP TABLE recipe_clone_runs;
ALTER TABLE recipe_clone_runs_next RENAME TO recipe_clone_runs;
ALTER TABLE recipe_clone_items_next RENAME TO recipe_clone_items;

CREATE INDEX idx_recipe_clone_runs_v316_account
  ON recipe_clone_runs(line_account_id, created_at DESC);
CREATE INDEX idx_recipe_clone_runs_v316_recipe
  ON recipe_clone_runs(recipe_id, created_at DESC);
CREATE INDEX idx_recipe_clone_items_v316_run
  ON recipe_clone_items(run_id, created_at, id);

-- 複製後は通常の定義として扱うが、監査用に出どころだけ残す。
ALTER TABLE tags ADD COLUMN created_from_recipe_id TEXT REFERENCES recipes(id);
ALTER TABLE tags ADD COLUMN recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id);
ALTER TABLE templates ADD COLUMN created_from_recipe_id TEXT REFERENCES recipes(id);
ALTER TABLE templates ADD COLUMN recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id);
ALTER TABLE scenarios ADD COLUMN created_from_recipe_id TEXT REFERENCES recipes(id);
ALTER TABLE scenarios ADD COLUMN recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id);
ALTER TABLE reminders ADD COLUMN created_from_recipe_id TEXT REFERENCES recipes(id);
ALTER TABLE reminders ADD COLUMN recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id);
ALTER TABLE auto_replies ADD COLUMN created_from_recipe_id TEXT REFERENCES recipes(id);
ALTER TABLE auto_replies ADD COLUMN recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id);
ALTER TABLE friend_add_rules ADD COLUMN created_from_recipe_id TEXT REFERENCES recipes(id);
ALTER TABLE friend_add_rules ADD COLUMN recipe_clone_run_id TEXT REFERENCES recipe_clone_runs(id);
