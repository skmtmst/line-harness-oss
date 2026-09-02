-- V6受信箱: 4つの対応状態、同時更新検査、追記型の操作履歴を追加する。
-- LINEとメールの既存データは統合せず、それぞれの表を保ったまま同じ意味へ揃える。

CREATE TABLE chats_v6 (
  id                       TEXT PRIMARY KEY,
  friend_id                TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  operator_id              TEXT REFERENCES operators (id) ON DELETE SET NULL,
  status                   TEXT NOT NULL DEFAULT 'unread'
                           CHECK (status IN ('unread', 'in_progress', 'on_hold', 'resolved')),
  notes                    TEXT,
  last_message_at          TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  line_account_id          TEXT,
  first_replied_at         TEXT,
  last_incoming_at         TEXT,
  revision                 INTEGER NOT NULL DEFAULT 0,
  last_customer_message_at TEXT,
  last_operator_message_at TEXT,
  next_response_due_at     TEXT
);

INSERT INTO chats_v6 (
  id, friend_id, operator_id, status, notes, last_message_at, created_at, updated_at,
  line_account_id, first_replied_at, last_incoming_at, revision,
  last_customer_message_at, last_operator_message_at, next_response_due_at
)
SELECT
  id, friend_id, operator_id, status, notes, last_message_at, created_at, updated_at,
  line_account_id, first_replied_at, last_incoming_at, 0,
  last_incoming_at, NULL, NULL
FROM chats;

DROP TABLE chats;
ALTER TABLE chats_v6 RENAME TO chats;
CREATE UNIQUE INDEX idx_chats_friend_unique ON chats (friend_id);
CREATE INDEX idx_chats_friend_status_message ON chats (friend_id, status, last_message_at);
CREATE INDEX idx_chats_operator ON chats (operator_id);
CREATE INDEX idx_chats_status ON chats (status);

-- 子表を先に控えてからメール会話を作り直す。外部キーのCASCADEで履歴を失わないため。
CREATE TABLE support_email_threads_v6 (
  id                       TEXT PRIMARY KEY,
  customer_email           TEXT NOT NULL,
  customer_name            TEXT,
  subject                  TEXT NOT NULL,
  normalized_subject       TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'unread'
                           CHECK (status IN ('unread', 'in_progress', 'on_hold', 'resolved')),
  assigned_staff_id        TEXT,
  last_message_at          TEXT NOT NULL,
  last_incoming_at         TEXT NOT NULL,
  last_outgoing_at         TEXT,
  resolved_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  notes                    TEXT,
  revision                 INTEGER NOT NULL DEFAULT 0,
  last_customer_message_at TEXT,
  last_operator_message_at TEXT,
  next_response_due_at     TEXT
);

INSERT INTO support_email_threads_v6 (
  id, customer_email, customer_name, subject, normalized_subject, status,
  assigned_staff_id, last_message_at, last_incoming_at, last_outgoing_at,
  resolved_at, created_at, updated_at, notes, revision,
  last_customer_message_at, last_operator_message_at, next_response_due_at
)
SELECT
  id, customer_email, customer_name, subject, normalized_subject, status,
  assigned_staff_id, last_message_at, last_incoming_at, last_outgoing_at,
  resolved_at, created_at, updated_at, notes, 0,
  last_incoming_at, last_outgoing_at, NULL
FROM support_email_threads;

CREATE TABLE support_email_messages_v6 (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL REFERENCES support_email_threads_v6 (id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  sender_email      TEXT NOT NULL,
  sender_name       TEXT,
  recipient_email   TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body_text         TEXT NOT NULL,
  message_id        TEXT UNIQUE,
  in_reply_to       TEXT,
  references_header TEXT,
  sent_by_staff_id  TEXT,
  created_at        TEXT NOT NULL
);

INSERT INTO support_email_messages_v6
SELECT id, thread_id, direction, sender_email, sender_name, recipient_email, subject,
       body_text, message_id, in_reply_to, references_header, sent_by_staff_id, created_at
FROM support_email_messages;

DROP TABLE support_email_messages;
DROP TABLE support_email_threads;
ALTER TABLE support_email_threads_v6 RENAME TO support_email_threads;
ALTER TABLE support_email_messages_v6 RENAME TO support_email_messages;
CREATE INDEX idx_support_email_threads_status_last
  ON support_email_threads (status, last_message_at DESC);
CREATE INDEX idx_support_email_threads_customer_subject
  ON support_email_threads (customer_email, normalized_subject, last_message_at DESC);
CREATE INDEX idx_support_email_messages_thread_created
  ON support_email_messages (thread_id, created_at ASC);
CREATE INDEX idx_support_email_messages_reply_lookup
  ON support_email_messages (message_id);

CREATE TABLE inbox_conversation_events (
  id              TEXT PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id TEXT NOT NULL,
  event_type      TEXT NOT NULL
                  CHECK (event_type IN ('assignment', 'status', 'note', 'read', 'send', 'conflict', 'unsend')),
  before_json     TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json      TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  actor_staff_id  TEXT,
  reason          TEXT,
  correlation_id  TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_inbox_conversation_events_lookup
  ON inbox_conversation_events (channel, conversation_id, created_at DESC);
CREATE UNIQUE INDEX idx_inbox_conversation_events_correlation
  ON inbox_conversation_events (correlation_id, event_type);

CREATE TABLE inbox_notes (
  id                    TEXT PRIMARY KEY,
  channel               TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id       TEXT NOT NULL,
  body                  TEXT NOT NULL,
  created_by_staff_id   TEXT,
  correction_of_note_id TEXT REFERENCES inbox_notes (id) ON DELETE SET NULL,
  invalidation_reason   TEXT,
  created_at            TEXT NOT NULL
);

CREATE INDEX idx_inbox_notes_lookup
  ON inbox_notes (channel, conversation_id, created_at ASC);

CREATE TABLE inbox_reply_leases (
  channel               TEXT NOT NULL CHECK (channel IN ('line', 'email')),
  conversation_id       TEXT NOT NULL,
  staff_id              TEXT NOT NULL,
  acquired_at           TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  conversation_revision INTEGER NOT NULL,
  PRIMARY KEY (channel, conversation_id)
);

CREATE INDEX idx_inbox_reply_leases_expiry ON inbox_reply_leases (expires_at);

-- 既存メモは消さず、移行前の記録として追記型台帳へ控える。
INSERT INTO inbox_notes (id, channel, conversation_id, body, created_at)
SELECT 'legacy-line-' || id, 'line', friend_id, notes, updated_at
FROM chats WHERE notes IS NOT NULL AND TRIM(notes) != '';

INSERT INTO inbox_notes (id, channel, conversation_id, body, created_at)
SELECT 'legacy-email-' || id, 'email', id, notes, updated_at
FROM support_email_threads WHERE notes IS NOT NULL AND TRIM(notes) != '';
