-- Migration 493: イベントの変更の記録と待ち順の手動操作（U-1）。
--
-- v6-29 §10（開催変更・中止）と確定文書 U の決めごと
-- 「状態を変える操作は、すべて誰が・いつ・何を・理由を記録に残す。
-- 記録は消さない。取り消しは逆向きの記録を足す」の受け皿。
-- 付け足しだけ。既存の列は触らない。
--
-- event_change_logs: 変更確認の適用・状態の切替・待ちの手動操作
-- （繰上げ・順番変更・飛ばし）・お客さんの開催回変更を1行ずつ残す。
-- before_json / after_json は変更前後の要点、affected_* は影響人数、
-- notify_* は LINE 通知の予定と結果。idempotency_key は適用の二重実行防止。

CREATE TABLE IF NOT EXISTS event_change_logs (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  event_id              TEXT NOT NULL,
  slot_id               TEXT,
  actor_id              TEXT,
  actor_role            TEXT,
  action                TEXT NOT NULL
    CHECK (action IN (
      'lifecycle',
      'change_review_apply',
      'waitlist_promote',
      'waitlist_reorder',
      'waitlist_skip',
      'booking_change'
    )),
  reason                TEXT,
  before_json           TEXT,
  after_json            TEXT,
  affected_confirmed    INTEGER NOT NULL DEFAULT 0,
  affected_waiting       INTEGER NOT NULL DEFAULT 0,
  affected_reminders     INTEGER NOT NULL DEFAULT 0,
  notify_planned         INTEGER NOT NULL DEFAULT 0,
  notify_sent            INTEGER NOT NULL DEFAULT 0,
  idempotency_key       TEXT,
  created_at            TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_event_change_logs_event
  ON event_change_logs (event_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_change_logs_idem
  ON event_change_logs (line_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- event_waitlist.sort_order: 手動の順番変更・飛ばしの置き場所。
-- 既定 0 で、案内の順番は (sort_order, created_at) の順に読む。
-- 既存行はすべて 0 のままなので、今までの「先に並んだ人から」は変わらない。
-- 飛ばしは最後尾へ回す（行は消さない）。取り消しは status で扱う。

ALTER TABLE event_waitlist ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_event_waitlist_slot_order
  ON event_waitlist (slot_id, status, sort_order, created_at);
