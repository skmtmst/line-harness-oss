-- 467: テンプレートの参照表 (#820)。どこで使われているかの正本。
-- JSON の文字列検索ではなく、この表を見る。利用先の保存時に書き換える。
-- consumer は一斉配信・シナリオ・自動応答の3種。版は固定 (fixed) で記録し、
-- 公開で版が進んでも、参照側の版番号は変えない。送った配信は送った時の版のまま。
CREATE TABLE IF NOT EXISTS template_references (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL
    REFERENCES templates(id) ON DELETE CASCADE,
  -- 使っている版 (templates.published_version と同じ番号)。版履歴より前の
  -- 参照は空のままにし、画面では「—」と出す（無い版番号をでっち上げない）。
  template_version_number INTEGER,
  consumer_kind TEXT NOT NULL
    CHECK (consumer_kind IN ('broadcast', 'scenario', 'auto_reply')),
  consumer_id TEXT NOT NULL,
  reference_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (reference_mode IN ('fixed', 'latest')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (template_id, consumer_kind, consumer_id)
);
CREATE INDEX IF NOT EXISTS idx_template_references_consumer
  ON template_references (consumer_kind, consumer_id);
CREATE INDEX IF NOT EXISTS idx_template_references_template
  ON template_references (template_id);

-- すでにある参照を引き継ぐ。シナリオの手順と自動応答は template_id 列を持つ。
-- 版は移行時点の公開版で固定する。一斉配信は本文を写して使うため移行元がなく、
-- 保存のたびに書き足す（削除前の参照は運用者が作り直す）。
INSERT OR IGNORE INTO template_references
  (id, template_id, template_version_number, consumer_kind, consumer_id, reference_mode, created_at)
SELECT lower(hex(randomblob(16))), ss.template_id, t.published_version,
    'scenario', ss.scenario_id, 'fixed', datetime('now')
  FROM scenario_steps ss
  JOIN templates t ON t.id = ss.template_id
 WHERE ss.template_id IS NOT NULL
 GROUP BY ss.template_id, ss.scenario_id;
INSERT OR IGNORE INTO template_references
  (id, template_id, template_version_number, consumer_kind, consumer_id, reference_mode, created_at)
SELECT lower(hex(randomblob(16))), ar.template_id, t.published_version,
    'auto_reply', ar.id, 'fixed', datetime('now')
  FROM auto_replies ar
  JOIN templates t ON t.id = ar.template_id
 WHERE ar.template_id IS NOT NULL AND ar.deleted_at IS NULL;
