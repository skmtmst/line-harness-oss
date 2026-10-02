-- 一括メッセージも一斉配信と同じ人数基準で承認を待つ。
CREATE TABLE friend_bulk_message_approvals (
  run_id TEXT PRIMARY KEY REFERENCES friend_bulk_runs(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'confirmed', 'expired')),
  recipient_count INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  confirmed_count INTEGER
);
CREATE TABLE friend_bulk_message_approval_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES friend_bulk_runs(id),
  actor_staff_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('requested', 'approved', 'confirmed', 'expired')),
  created_at TEXT NOT NULL
);
