-- 短縮URLの出どころと、操作の記録。
--
-- ■ tracked_links.template_id（docs/v025-open-questions.md §C）
--
-- 短縮URLはテンプレート本文から自動で作られるが、どのテンプレート由来かを
-- 持っていない。そのためテンプレートの「平均クリック率」が出せない。
--
-- 1列足せば、クリックをテンプレート単位で数えられる。
ALTER TABLE tracked_links ADD COLUMN template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tracked_links_template
  ON tracked_links (template_id);

-- ■ operation_audit（docs/v025-open-questions.md §E）
--
-- 対応マークも保存した検索も、いまの値しか持っていない。設計は
-- 「過去7日で対応済にした人数」「今月の呼び出し回数」のように
-- 期間で切って見せる。
--
-- 個別に履歴表を足すより、汎用の記録を1つ持つほうがよい。
-- login_audit（103）と同じ形にしている。
CREATE TABLE IF NOT EXISTS operation_audit (
  id            TEXT PRIMARY KEY,
  -- 何に対する操作か。'support_mark' | 'saved_search' | 'tag' など。
  target_kind   TEXT NOT NULL,
  target_id     TEXT,
  -- 何をしたか。'changed' | 'used' | 'created' | 'deleted' など。
  action        TEXT NOT NULL,
  -- 誰が。自動なら NULL。
  actor_id      TEXT,
  -- 対象の友だち。友だちに紐づかない操作なら NULL。
  friend_id     TEXT,
  -- 補足。変更前後の値など。JSON。
  detail_json   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 「この種類の操作が、この期間に何回あったか」が唯一の読み方。
CREATE INDEX IF NOT EXISTS idx_operation_audit_kind_date
  ON operation_audit (target_kind, created_at);
