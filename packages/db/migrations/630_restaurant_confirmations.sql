-- オーナー承認 2026-10-10: PLAN §2「前日の案内への返事」。計画629を630へ採番。
CREATE TABLE rt_reservation_confirmations (
 request_id TEXT PRIMARY KEY,
 reservation_id TEXT NOT NULL REFERENCES rt_reservations(id),
 reservation_version INTEGER NOT NULL CHECK(reservation_version>=1),
 friend_id TEXT NOT NULL REFERENCES friends(id),
 response TEXT CHECK(response IN('going','change_requested','cancel')),
 requested_at TEXT NOT NULL,
 responded_at TEXT,
 expires_at TEXT NOT NULL,
 UNIQUE(reservation_id,reservation_version,request_id)
);
CREATE INDEX rt_confirmation_reservation ON rt_reservation_confirmations(reservation_id,reservation_version);
