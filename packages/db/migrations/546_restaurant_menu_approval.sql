-- メニューの価格は申請を承認してから反映する。既存の公開履歴が不明な停止済みメニューは保護する。
ALTER TABLE rt_menu_items ADD COLUMN published_once INTEGER NOT NULL DEFAULT 0 CHECK (published_once IN (0, 1));
ALTER TABLE rt_menu_items ADD COLUMN publication_history_unknown INTEGER NOT NULL DEFAULT 0 CHECK (publication_history_unknown IN (0, 1));
-- 導入前に公開から下書きへ戻したかは旧データから判別できない。推測で削除を許可しない。
UPDATE rt_menu_items SET publication_history_unknown = 1 WHERE status = 'draft';
UPDATE rt_menu_items SET published_once = 1 WHERE status <> 'draft'
  OR EXISTS (SELECT 1 FROM rt_reservations r WHERE r.course_id = rt_menu_items.id);

CREATE TRIGGER rt_menu_published_insert AFTER INSERT ON rt_menu_items WHEN NEW.status = 'active' BEGIN UPDATE rt_menu_items SET published_once = 1 WHERE id = NEW.id; END;
CREATE TRIGGER rt_menu_published_update AFTER UPDATE OF status ON rt_menu_items WHEN NEW.status = 'active' BEGIN UPDATE rt_menu_items SET published_once = 1 WHERE id = NEW.id; END;

CREATE TABLE rt_menu_change_requests (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL UNIQUE REFERENCES rt_approval_requests(id),
  menu_id TEXT NOT NULL REFERENCES rt_menu_items(id),
  store_id TEXT NOT NULL REFERENCES rt_stores(id),
  before_price INTEGER NOT NULL CHECK (before_price >= 0),
  after_price INTEGER NOT NULL CHECK (after_price >= 0),
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'returned', 'applied', 'failed')),
  return_reason TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_rt_menu_change_pending ON rt_menu_change_requests(menu_id) WHERE status IN ('pending', 'approved');

-- 承認と価格の変更を同じ書き込みで行い、二重承認や同時更新で部分反映しない。
CREATE TRIGGER rt_menu_change_review AFTER UPDATE OF status ON rt_approval_requests WHEN NEW.kind = 'menu_change' AND OLD.status = 'pending' AND NEW.status IN ('approved', 'returned') BEGIN UPDATE rt_menu_change_requests SET status = NEW.status, return_reason = CASE WHEN NEW.status = 'returned' THEN NEW.review_comment ELSE NULL END, updated_at = datetime('now') WHERE approval_id = NEW.id AND status = 'pending'; END;
CREATE TRIGGER rt_menu_change_apply AFTER UPDATE OF status ON rt_menu_change_requests WHEN OLD.status = 'pending' AND NEW.status = 'approved' BEGIN UPDATE rt_menu_items SET price = NEW.after_price, updated_at = datetime('now') WHERE id = NEW.menu_id AND store_id = NEW.store_id AND price = NEW.before_price; UPDATE rt_menu_change_requests SET status = CASE WHEN changes() = 1 THEN 'applied' ELSE 'failed' END, failure_reason = CASE WHEN changes() = 1 THEN NULL ELSE 'メニューが変更または削除されています。再申請してください' END, updated_at = datetime('now') WHERE id = NEW.id; END;
