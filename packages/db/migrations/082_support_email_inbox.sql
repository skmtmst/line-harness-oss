-- LINEとメールを同じCS導線で扱うためのメール会話ストア。
CREATE TABLE IF NOT EXISTS support_email_threads (
  id                 TEXT PRIMARY KEY,
  customer_email     TEXT NOT NULL,
  customer_name      TEXT,
  subject            TEXT NOT NULL,
  normalized_subject TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'unread'
                     CHECK (status IN ('unread', 'in_progress', 'resolved')),
  assigned_staff_id  TEXT,
  last_message_at    TEXT NOT NULL,
  last_incoming_at   TEXT NOT NULL,
  last_outgoing_at   TEXT,
  resolved_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_email_threads_status_last
  ON support_email_threads (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_email_threads_customer_subject
  ON support_email_threads (customer_email, normalized_subject, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_email_messages (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL REFERENCES support_email_threads (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_support_email_messages_thread_created
  ON support_email_messages (thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_email_messages_reply_lookup
  ON support_email_messages (message_id);
