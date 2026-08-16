-- イベントのキャンセル待ち。
--
-- event_bookings.status に 'waitlisted' を足す形にはできなかった。
-- status の CHECK 制約は作り直さないと値を増やせず、追加のみポリシーで
-- 禁じている（CONTRIBUTING.md §Migration Policy）。
--
-- 別テーブルにしたことで、定員の数え方に手を入れずに済むという利点もある。
-- event_bookings を数えている箇所は多く、そこへ「待ちは数えない」条件を
-- 足して回ると、必ずどこかで漏れる。

CREATE TABLE IF NOT EXISTS event_waitlist (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL,
  slot_id       TEXT NOT NULL,
  friend_id     TEXT NOT NULL,
  -- 予約と同じ識別子。複数アカウントの同一人物が二重に並ばないようにする。
  identity_key  TEXT NOT NULL,
  -- waiting: 待っている / invited: 空きを知らせた / converted: 予約になった
  -- / cancelled: 本人が取り消した
  status        TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'invited', 'converted', 'cancelled')),
  notified_at   TEXT,
  created_at    TEXT NOT NULL
);

-- 同じ枠に同じ人が二度並べない。
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_waitlist_slot_identity
  ON event_waitlist(slot_id, identity_key);

-- 空きが出たときに「先に並んだ人から」を引く。
CREATE INDEX IF NOT EXISTS idx_event_waitlist_slot_created
  ON event_waitlist(slot_id, status, created_at);
