-- リファラルリンクのジャンルを、リンクが0件でも保持できる独立した管理単位にする。
CREATE TABLE IF NOT EXISTS entry_route_genres (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entry_route_genres_created
  ON entry_route_genres (created_at ASC);

-- 085で既に入力済みのジャンルを管理一覧へ引き継ぐ。
INSERT OR IGNORE INTO entry_route_genres (id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), trim(genre), MIN(created_at), MAX(updated_at)
FROM entry_routes
WHERE genre IS NOT NULL AND trim(genre) <> ''
GROUP BY trim(genre);
