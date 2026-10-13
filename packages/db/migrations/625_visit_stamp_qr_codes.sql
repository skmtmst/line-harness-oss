-- オーナー承認 2026-10-10 / PLAN 625（未共有・未適用の617案を625へ採番）。既存表は変更しない。D1適用は司令塔の別工程。
CREATE TABLE visit_stamp_qr_codes (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  kind TEXT NOT NULL CHECK(kind IN ('storefront','staff')),
  token TEXT NOT NULL UNIQUE,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  card_version INTEGER NOT NULL,
  base_count INTEGER NOT NULL CHECK(base_count BETWEEN 1 AND 10000),
  amount INTEGER CHECK(amount BETWEEN 0 AND 100000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','used','revoked')),
  consumed_friend_id TEXT,
  consumed_at TEXT,
  consumed_entry_id TEXT REFERENCES visit_stamp_entries(id),
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation>0),
  rotation_key TEXT,
  UNIQUE(card_id,line_account_id,kind,issued_by,request_id),
  UNIQUE(card_id,line_account_id,kind,session_id,generation),
  CHECK((kind='staff' AND expires_at IS NOT NULL) OR (kind='storefront' AND expires_at IS NULL)),
  CHECK((status='used' AND consumed_friend_id IS NOT NULL AND consumed_at IS NOT NULL AND consumed_entry_id IS NOT NULL) OR status<>'used')
);
CREATE UNIQUE INDEX visit_stamp_qr_one_active
  ON visit_stamp_qr_codes(card_id,line_account_id,kind,session_id) WHERE status='active';
CREATE INDEX visit_stamp_qr_account ON visit_stamp_qr_codes(line_account_id);
