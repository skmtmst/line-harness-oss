-- V6 行動スコアの版管理と追記台帳（migration 276）。
--
-- 旧 scoring_rules は所属アカウントを持たないため、推測で移送しない。
-- V6を公開したLINEアカウントだけ新しい公開版を使い、それ以外は移行が
-- 終わるまで旧ルールを読み続けられるよう、別の受け皿として追加する。

CREATE TABLE IF NOT EXISTS action_score_rule_sets (
  id                           TEXT PRIMARY KEY,
  line_account_id              TEXT NOT NULL UNIQUE REFERENCES line_accounts(id),
  status                       TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'stopped')),
  current_draft_version_id     TEXT REFERENCES action_score_rule_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  current_published_version_id TEXT REFERENCES action_score_rule_versions(id)
                                 DEFERRABLE INITIALLY DEFERRED,
  created_by                   TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_score_rule_sets_account_status
  ON action_score_rule_sets(line_account_id, status);

CREATE TABLE IF NOT EXISTS action_score_rule_versions (
  id               TEXT PRIMARY KEY,
  rule_set_id      TEXT NOT NULL REFERENCES action_score_rule_sets(id),
  version_number   INTEGER NOT NULL CHECK (version_number > 0),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published')),
  rules_json       TEXT NOT NULL DEFAULT '[]',
  min_score        INTEGER NOT NULL DEFAULT 0,
  max_score        INTEGER NOT NULL DEFAULT 100,
  normal_min       INTEGER NOT NULL DEFAULT 30,
  high_min         INTEGER NOT NULL DEFAULT 70,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  published_by     TEXT,
  published_at     TEXT,
  UNIQUE (rule_set_id, version_number),
  CHECK (min_score >= 0),
  CHECK (max_score > min_score),
  CHECK (normal_min > min_score AND normal_min < high_min),
  CHECK (high_min < max_score)
);

CREATE INDEX IF NOT EXISTS idx_action_score_rule_versions_set_status
  ON action_score_rule_versions(rule_set_id, status, version_number DESC);

CREATE TRIGGER IF NOT EXISTS trg_action_score_published_version_immutable
BEFORE UPDATE ON action_score_rule_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published action score version is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_action_score_published_version_no_delete
BEFORE DELETE ON action_score_rule_versions
WHEN OLD.status = 'published'
BEGIN SELECT RAISE(ABORT, 'published action score version cannot be deleted'); END;

-- 既存履歴はNULLのまま残す。元イベントが説明できる新しい処理だけ、以下を埋める。
ALTER TABLE friend_scores ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);
ALTER TABLE friend_scores ADD COLUMN event_type TEXT;
ALTER TABLE friend_scores ADD COLUMN source TEXT;
ALTER TABLE friend_scores ADD COLUMN source_event_id TEXT;
ALTER TABLE friend_scores ADD COLUMN subject_key TEXT;
ALTER TABLE friend_scores ADD COLUMN frequency_key TEXT;
ALTER TABLE friend_scores ADD COLUMN rule_key TEXT;
ALTER TABLE friend_scores ADD COLUMN rule_version_id TEXT REFERENCES action_score_rule_versions(id);
ALTER TABLE friend_scores ADD COLUMN idempotency_key TEXT;
ALTER TABLE friend_scores ADD COLUMN operation TEXT
  CHECK (operation IS NULL OR operation IN ('delta', 'set', 'manual_adjustment'));
ALTER TABLE friend_scores ADD COLUMN score_before INTEGER;
ALTER TABLE friend_scores ADD COLUMN score_after INTEGER;
ALTER TABLE friend_scores ADD COLUMN occurred_at TEXT;
ALTER TABLE friend_scores ADD COLUMN executed_by_staff_id TEXT;
ALTER TABLE friend_scores ADD COLUMN executed_by_staff_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_scores_account_idempotency
  ON friend_scores(line_account_id, idempotency_key)
  WHERE line_account_id IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_friend_scores_rule_frequency
  ON friend_scores(line_account_id, friend_id, rule_key, frequency_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_friend_scores_source_event
  ON friend_scores(line_account_id, source, source_event_id);

-- V6履歴は INSERT ... SELECT で変更前後を確定してから、このトリガーで
-- friends.score を同じ文の中で更新する。履歴だけ／現在値だけになるのを防ぐ。
CREATE TRIGGER IF NOT EXISTS trg_friend_scores_v6_snapshot
AFTER INSERT ON friend_scores
WHEN NEW.line_account_id IS NOT NULL
 AND NEW.operation IN ('delta', 'set', 'manual_adjustment')
 AND NEW.score_after IS NOT NULL
BEGIN UPDATE friends SET score = NEW.score_after, updated_at = COALESCE(NEW.occurred_at, NEW.created_at, updated_at) WHERE id = NEW.friend_id AND line_account_id = NEW.line_account_id; SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'action score friend account mismatch') END; END;
