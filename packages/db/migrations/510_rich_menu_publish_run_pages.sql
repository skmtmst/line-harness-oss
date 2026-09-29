-- K(#822): 公開のページ実行台帳。公開の4つの段（画像を上げる・
-- メニューを作る・友だちに割り当てる・前のメニューを片付ける）を
-- ページごとに残し、「公開の進み」画面の元にする。
-- 割り当ては alias の付け替え（と全員既定の設定）を指す。

CREATE TABLE IF NOT EXISTS rich_menu_publish_run_pages (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES rich_menu_publish_runs(id) ON DELETE CASCADE,
  page_id             TEXT NOT NULL,
  order_index         INTEGER NOT NULL,
  alias_id            TEXT NOT NULL,
  old_line_richmenu_id TEXT,
  new_line_richmenu_id TEXT,
  create_status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (create_status IN ('pending', 'succeeded', 'failed')),
  image_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (image_status IN ('pending', 'succeeded', 'failed')),
  alias_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (alias_status IN ('pending', 'succeeded', 'failed')),
  cleanup_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (cleanup_status IN ('pending', 'succeeded', 'failed', 'skipped')),
  last_error_code     TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rich_menu_publish_run_pages_run_page
  ON rich_menu_publish_run_pages(run_id, page_id);
CREATE INDEX IF NOT EXISTS idx_rich_menu_publish_run_pages_run
  ON rich_menu_publish_run_pages(run_id, order_index);
