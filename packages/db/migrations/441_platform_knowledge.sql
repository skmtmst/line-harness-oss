-- Ops-only knowledge. Additive: no historical ticket backfill or data rewrite.
-- 441 allocated after checking development and open PRs on 2026-09-20.
ALTER TABLE hq_support_requests ADD COLUMN knowledge_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE platform_knowledge_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES hq_support_requests(id),
  source_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','stale')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(request_id, source_revision)
);
CREATE INDEX idx_platform_knowledge_jobs_pending ON platform_knowledge_jobs(status, lease_until);

CREATE TABLE platform_knowledge_articles (
  id TEXT PRIMARY KEY,
  source_request_id TEXT NOT NULL REFERENCES hq_support_requests(id),
  source_revision INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('usage','bug','billing','feature','other')),
  keywords TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'ops_only' CHECK (visibility = 'ops_only'),
  review_state TEXT NOT NULL CHECK (review_state IN ('pending','approved','needs_review','dismissed')),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active','disabled')),
  evidence TEXT NOT NULL DEFAULT '[]',
  review_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  approved_by_staff_id TEXT REFERENCES staff_members(id),
  approved_at TEXT,
  used_count INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  unhelpful_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_request_id, source_revision)
);
CREATE INDEX idx_platform_knowledge_articles_review ON platform_knowledge_articles(review_state, status, kind);

CREATE TABLE platform_knowledge_usage (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES platform_knowledge_articles(id),
  article_version INTEGER NOT NULL,
  request_id TEXT NOT NULL REFERENCES hq_support_requests(id),
  staff_id TEXT NOT NULL REFERENCES staff_members(id),
  feedback TEXT CHECK (feedback IN ('helpful','unhelpful')),
  created_at TEXT NOT NULL,
  UNIQUE(article_id, request_id)
);
CREATE TABLE platform_ai_calls (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('draft','article')),
  request_id TEXT NOT NULL REFERENCES hq_support_requests(id),
  staff_id TEXT REFERENCES staff_members(id),
  model TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_platform_ai_calls_month ON platform_ai_calls(created_at, purpose);

ALTER TABLE hq_support_reply_drafts ADD COLUMN knowledge_references TEXT NOT NULL DEFAULT '[]';
