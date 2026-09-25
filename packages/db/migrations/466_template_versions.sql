-- 466: テンプレートの版履歴 (#820)。
-- 公開のたびに1行足す。前の版は変えない（追記だけ。UPDATE・DELETE しない）。
-- 「この版に戻す」はこの表の行を変えず、その中身で新しい版を作る。
-- 使い始めの日時 (effective_from) を版ごとに持てる。空なら公開と同時。
CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL
    REFERENCES templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  message_content TEXT NOT NULL,
  carousel_actions_json TEXT,
  carousel_tap_limit_mode TEXT,
  carousel_tap_limit_text TEXT,
  question_json TEXT,
  question_status TEXT,
  -- 使い始めの日時。空は「公開と同時」。未来の日時は「予約」の札で見せる。
  effective_from TEXT,
  created_by_staff_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (template_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_template_versions_template
  ON template_versions (template_id, version_number DESC);

-- 公開済みのテンプレートは、いまの公開内容をその版番号で1行残す。
-- 未公開（published_at なし）は版を持たない。初公開で版1が生まれる。
INSERT OR IGNORE INTO template_versions
  (id, template_id, version_number, message_type, message_content,
   carousel_actions_json, carousel_tap_limit_mode, carousel_tap_limit_text,
   question_json, question_status, effective_from, created_at)
SELECT lower(hex(randomblob(16))), id, published_version, message_type, message_content,
   carousel_actions_json, carousel_tap_limit_mode, carousel_tap_limit_text,
   question_json, question_status, published_at, published_at
  FROM templates
 WHERE published_version >= 1 AND published_at IS NOT NULL;
