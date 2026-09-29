-- migration-policy: table-rebuild
-- 機能14: 差し込み名をLINEアカウント単位で一意にし、削除済みの行と履歴を残す。
-- archived_at と履歴表は 313 で追加済みのため、ここでは重ねて追加しない。

-- 旧スキーマでは全アカウントを通した UNIQUE(var_key) だった。制約が外れていた
-- 環境に同一アカウント内の重複があっても移行を止めず、古い1件だけを有効として
-- 残し、それ以外は理由付きでアーカイブする。

CREATE TABLE common_vars_new (
  id                 TEXT PRIMARY KEY,
  folder_id          TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  var_key            TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'text'
                       CHECK (type IN ('text','url','image','number')),
  value              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  line_account_id    TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  memo               TEXT NOT NULL DEFAULT '',
  version            INTEGER NOT NULL DEFAULT 1,
  updated_by         TEXT,
  archived_at        TEXT,
  replacement_run_id TEXT,
  UNIQUE(line_account_id, var_key)
);

INSERT INTO common_vars_new (
  id, folder_id, name, var_key, type, value, created_at, updated_at,
  line_account_id, memo, version, updated_by, archived_at, replacement_run_id
)
SELECT
  cv.id,
  cv.folder_id,
  cv.name,
  CASE WHEN cv.id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY line_account_id, var_key ORDER BY created_at ASC, id ASC
           ) AS duplicate_order
           FROM common_vars
           WHERE line_account_id IS NOT NULL AND archived_at IS NULL
         ) WHERE duplicate_order > 1
       ) THEN cv.var_key
       ELSE cv.var_key || '__archived_' || cv.id END,
  cv.type,
  cv.value,
  cv.created_at,
  CASE WHEN cv.id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY line_account_id, var_key ORDER BY created_at ASC, id ASC
           ) AS duplicate_order
           FROM common_vars
           WHERE line_account_id IS NOT NULL AND archived_at IS NULL
         ) WHERE duplicate_order > 1
       ) THEN cv.updated_at
       ELSE strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') END,
  cv.line_account_id,
  cv.memo,
  cv.version + CASE WHEN cv.id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY line_account_id, var_key ORDER BY created_at ASC, id ASC
      ) AS duplicate_order
      FROM common_vars
      WHERE line_account_id IS NOT NULL AND archived_at IS NULL
    ) WHERE duplicate_order > 1
  ) THEN 0 ELSE 1 END,
  cv.updated_by,
  CASE WHEN cv.id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY line_account_id, var_key ORDER BY created_at ASC, id ASC
           ) AS duplicate_order
           FROM common_vars
           WHERE line_account_id IS NOT NULL AND archived_at IS NULL
         ) WHERE duplicate_order > 1
       ) THEN cv.archived_at
       ELSE strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') END,
  cv.replacement_run_id
FROM common_vars cv;

-- common_vars を参照する3表を先に新しい親へ付け替え、履歴を消さずに入れ替える。
CREATE TABLE common_var_schedules_next (
  id             TEXT PRIMARY KEY,
  var_id         TEXT NOT NULL REFERENCES common_vars_new(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  value          TEXT NOT NULL,
  applied_at     TEXT
);
INSERT INTO common_var_schedules_next (id, var_id, effective_from, value, applied_at)
SELECT id, var_id, effective_from, value, applied_at FROM common_var_schedules;

CREATE TABLE common_var_versions_next (
  id             TEXT PRIMARY KEY,
  common_var_id  TEXT NOT NULL REFERENCES common_vars_new(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL,
  name           TEXT NOT NULL,
  value          TEXT NOT NULL,
  memo           TEXT NOT NULL DEFAULT '',
  change_reason  TEXT NOT NULL,
  actor_id       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  UNIQUE(common_var_id, version_no)
);
INSERT INTO common_var_versions_next
  (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
SELECT id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at
FROM common_var_versions;
INSERT INTO common_var_versions_next
  (id, common_var_id, version_no, name, value, memo, change_reason, actor_id, created_at)
SELECT
  'migration-338-' || cv.id,
  cv.id,
  cv.version + 1,
  cv.name,
  cv.value,
  cv.memo,
  '同一アカウント内で重複していた差し込み名を整理してアーカイブ',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
FROM common_vars cv
WHERE cv.id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY line_account_id, var_key ORDER BY created_at ASC, id ASC
    ) AS duplicate_order
    FROM common_vars
    WHERE line_account_id IS NOT NULL AND archived_at IS NULL
  ) WHERE duplicate_order > 1
);

CREATE TABLE common_var_replacement_runs_next (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  source_common_var_id  TEXT NOT NULL REFERENCES common_vars_new(id),
  replacement_common_var_id TEXT NOT NULL REFERENCES common_vars_new(id),
  source_version        INTEGER NOT NULL,
  expected_usage_count  INTEGER NOT NULL,
  replaced_usage_count  INTEGER NOT NULL,
  actor_id              TEXT,
  status                TEXT NOT NULL CHECK (status IN ('completed', 'partial')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
INSERT INTO common_var_replacement_runs_next (
  id, line_account_id, source_common_var_id, replacement_common_var_id,
  source_version, expected_usage_count, replaced_usage_count, actor_id, status, created_at
)
SELECT
  id, line_account_id, source_common_var_id, replacement_common_var_id,
  source_version, expected_usage_count, replaced_usage_count, actor_id, status, created_at
FROM common_var_replacement_runs;

DROP TABLE common_var_schedules;
DROP TABLE common_var_versions;
DROP TABLE common_var_replacement_runs;
DROP TABLE common_vars;

ALTER TABLE common_vars_new RENAME TO common_vars;
ALTER TABLE common_var_schedules_next RENAME TO common_var_schedules;
ALTER TABLE common_var_versions_next RENAME TO common_var_versions;
ALTER TABLE common_var_replacement_runs_next RENAME TO common_var_replacement_runs;

-- 表の再構築前と同じ索引名だと適用判定で飛ばされるため、338 固有名で貼り直す。
CREATE INDEX idx_common_vars_v338_account_name
  ON common_vars(line_account_id, name, id);
CREATE INDEX idx_common_vars_v338_account_active
  ON common_vars(line_account_id, archived_at, name, id);
CREATE INDEX idx_common_var_schedules_v338_pending
  ON common_var_schedules(var_id, effective_from) WHERE applied_at IS NULL;
CREATE INDEX idx_common_var_versions_v338_history
  ON common_var_versions(common_var_id, version_no DESC);
CREATE INDEX idx_common_var_replacement_runs_v338_source
  ON common_var_replacement_runs(source_common_var_id, created_at DESC);
