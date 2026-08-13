-- Rank and describe knowledge sources so official veterinary guidance wins retrieval.
ALTER TABLE nen_knowledge_articles ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'commercial_editorial';
ALTER TABLE nen_knowledge_articles ADD COLUMN authority_rank INTEGER NOT NULL DEFAULT 40;
ALTER TABLE nen_knowledge_articles ADD COLUMN language TEXT NOT NULL DEFAULT 'ja';
ALTER TABLE nen_knowledge_articles ADD COLUMN reviewed_at TEXT;

UPDATE nen_knowledge_articles
   SET source_kind = 'commercial_editorial', authority_rank = 40, language = 'ja'
 WHERE id LIKE 'pfirst-%';

CREATE INDEX IF NOT EXISTS idx_nen_knowledge_authority
  ON nen_knowledge_articles(is_active, animal_type, authority_rank DESC);
