-- Additive knowledge article classification. Existing approved articles remain verified.
ALTER TABLE platform_knowledge_articles
  ADD COLUMN article_kind TEXT NOT NULL DEFAULT 'verified'
  CHECK (article_kind IN ('verified','answer_example'));

CREATE INDEX idx_platform_knowledge_articles_kind_review
  ON platform_knowledge_articles(article_kind, review_state, status, kind);
