-- 421: 運営コンソールのお問い合わせ（チケット）★V6 37-6 / 37-6-A / 37-6-B
--
-- 統括からの問い合わせ（hq_support_requests, 36-3）を運営側で「チケット」として
-- 扱うための列と、返信のやり取りを残す表を足す。
--
-- status は CHECK (open/answered/closed) を後から変えられないので、運営の細かい
-- 進み具合は stage に持つ。status は統括の画面向けの粗い状態として stage から導く
--   new / in_progress / waiting → open（返信済みなら answered）
--   resolved / closed          → closed
--
-- 既存行は ticket_no を作成順で埋める。以後の採番は platform_counters で行う。

ALTER TABLE hq_support_requests ADD COLUMN ticket_no INTEGER;
ALTER TABLE hq_support_requests ADD COLUMN stage TEXT NOT NULL DEFAULT 'new'
  CHECK (stage IN ('new', 'in_progress', 'waiting', 'resolved', 'closed'));
ALTER TABLE hq_support_requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high'));
-- 受付の口。admin = 管理画面のお問い合わせ、line = 契約者専用LINE、ops = 運営が起票
ALTER TABLE hq_support_requests ADD COLUMN channel TEXT NOT NULL DEFAULT 'admin'
  CHECK (channel IN ('admin', 'line', 'ops'));
-- 件名を自動で付けたか（LINE受付など本文だけのとき）。画面に「自動で付けた件名」の札を出す
ALTER TABLE hq_support_requests ADD COLUMN subject_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hq_support_requests ADD COLUMN assignee_staff_id TEXT;
ALTER TABLE hq_support_requests ADD COLUMN first_replied_at TEXT;
ALTER TABLE hq_support_requests ADD COLUMN last_message_at TEXT;
ALTER TABLE hq_support_requests ADD COLUMN resolved_at TEXT;
ALTER TABLE hq_support_requests ADD COLUMN closed_at TEXT;

UPDATE hq_support_requests
   SET ticket_no = (SELECT COUNT(*) FROM hq_support_requests h2
                     WHERE h2.created_at < hq_support_requests.created_at
                        OR (h2.created_at = hq_support_requests.created_at AND h2.id <= hq_support_requests.id)),
       stage = CASE status WHEN 'closed' THEN 'closed' WHEN 'answered' THEN 'waiting' ELSE 'new' END,
       last_message_at = COALESCE(last_message_at, created_at)
 WHERE ticket_no IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hq_support_requests_ticket_no
  ON hq_support_requests(ticket_no) WHERE ticket_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hq_support_requests_stage
  ON hq_support_requests(stage, last_message_at DESC);

-- 通し番号などの採番。D1 に sequence が無いので 1 行更新で取る。
CREATE TABLE IF NOT EXISTS platform_counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO platform_counters (name, value)
  SELECT 'support_ticket', COALESCE(MAX(ticket_no), 0) FROM hq_support_requests
  WHERE NOT EXISTS (SELECT 1 FROM platform_counters WHERE name = 'support_ticket');

-- チケットのやり取り。最初の本文は hq_support_requests.body に残し、ここには
-- 2通目以降（運営の返信・統括の追記）を入れる。
CREATE TABLE IF NOT EXISTS hq_support_messages (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES hq_support_requests(id) ON DELETE CASCADE,
  author_kind      TEXT NOT NULL CHECK (author_kind IN ('tenant', 'ops')),
  author_staff_id  TEXT,
  author_name      TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL,
  attachment_keys  TEXT NOT NULL DEFAULT '[]',
  -- AI の下書きをそのまま／直して送ったか（品質の振り返り用）
  ai_assisted      INTEGER NOT NULL DEFAULT 0,
  -- 統括へ届けた手段の記録（JSON 配列: email / screen / line）
  delivered_via    TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_hq_support_messages_request
  ON hq_support_messages(request_id, created_at);

-- 返信の下書き。チケット 1 件につき 1 つ。AI が作ったものも人が書きかけたものも同じ場所。
CREATE TABLE IF NOT EXISTS hq_support_reply_drafts (
  request_id       TEXT PRIMARY KEY REFERENCES hq_support_requests(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  ai_generated     INTEGER NOT NULL DEFAULT 0,
  generated_at     TEXT,
  author_staff_id  TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
