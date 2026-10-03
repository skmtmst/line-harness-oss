-- 559: 予約の追加機能（前回と同じで予約・キャンセル待ち・今日の予約の印、
-- 今日の予約の席（卓）版）。
-- 作るだけで適用しない。画面は作らない。
-- 席の表は 562 で作っていたが、562 は M3 の番号とぶつかるため 559 に1本化した。
--
-- booking_waitlist: 満席の枠のキャンセル待ち。枠は「同じ店・同じ担当・
-- 同じ開始時刻」。event_waitlist と同じ考え方で、別表にする
-- （bookings の数え方に手を入れずに済む）。
-- booking_visit_marks: 今日の予約に付ける「来店した・遅れる・来なかった」
-- の印。だれがいつ付けたかを残す。予約の状態変更はこの印が起点。
-- booking_settings.waitlist_hold_minutes: 空きを知らせてから、その人だけが
-- 取れる仮押さえの分数（店の設定。既定30）。
-- rt_seat_waitlist: 席の空き待ち。枠は「同じ店・同じ開始時刻」で、
-- 組の人数が入る席だけが候補になる。取り消しで席が空いたら、
-- 組の早い順に1組ずつ知らせる（booking_waitlist と同じ考え方）。
-- rt_seat_visit_marks: 席の予約に付ける「来店した・遅れる・来なかった」の印。
-- 人の booking_visit_marks とそろえ、だれがいつ付けたかを残す。
-- 来店した→seated、来なかった→no_show、遅れる→状態は変えない。

CREATE TABLE IF NOT EXISTS booking_waitlist (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  staff_id              TEXT NOT NULL REFERENCES staff(id),
  menu_id               TEXT NOT NULL REFERENCES menus(id),
  starts_at             TEXT NOT NULL,
  friend_id             TEXT REFERENCES friends(id) ON DELETE SET NULL,
  booking_customer_id   TEXT REFERENCES booking_customers(id) ON DELETE SET NULL,
  -- 枠の中の本人確認。friend_id / booking_customer_id のどちらか。
  -- 同じ枠に同じ人が二度並べないための鍵。
  identity_key          TEXT NOT NULL,
  -- waiting: 待っている / invited: 空きを知らせた（仮押さえ中）
  -- / converted: 予約になった / cancelled: 本人が取り消した
  status                TEXT NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting', 'invited', 'converted', 'cancelled')),
  hold_minutes          INTEGER NOT NULL DEFAULT 30 CHECK (hold_minutes BETWEEN 1 AND 1440),
  invited_at            TEXT,
  hold_expires_at       TEXT,
  -- LINE を送った時刻。LINE 未連携の電話客は店が電話するため NULL のまま。
  notified_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (friend_id IS NOT NULL OR booking_customer_id IS NOT NULL)
);

-- 同じ枠に同じ人が二度並べない（待っている・仮押さえ中だけ）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_waitlist_slot_identity
  ON booking_waitlist(line_account_id, staff_id, starts_at, identity_key)
  WHERE status IN ('waiting', 'invited');

-- 空きが出たときに「先に並んだ人から」を引く。
CREATE INDEX IF NOT EXISTS idx_booking_waitlist_slot_created
  ON booking_waitlist(line_account_id, staff_id, starts_at, status, created_at);

CREATE TABLE IF NOT EXISTS booking_visit_marks (
  id                    TEXT PRIMARY KEY,
  booking_id            TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  line_account_id       TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- visited: 来店した / late: 遅れる / no_show: 来なかった
  kind                  TEXT NOT NULL CHECK (kind IN ('visited', 'late', 'no_show')),
  -- late のときだけ必須の遅れ分数。
  late_minutes          INTEGER CHECK (late_minutes IS NULL OR (late_minutes BETWEEN 1 AND 1440)),
  -- 付けた人（ログイン利用者）。予約の担当表とは別物なので外部キーは付けない
  -- （監査の actor と同じ考え方）。表示名も一緒に残す。
  marked_by_staff_id    TEXT,
  marked_by_name        TEXT,
  -- UTC ISO8601。付けた時刻。
  marked_at             TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK ((kind = 'late' AND late_minutes IS NOT NULL)
      OR (kind != 'late' AND late_minutes IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_booking_visit_marks_booking
  ON booking_visit_marks(booking_id, marked_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_visit_marks_account
  ON booking_visit_marks(line_account_id, marked_at DESC);

ALTER TABLE booking_settings
  ADD COLUMN waitlist_hold_minutes INTEGER NOT NULL DEFAULT 30
  CHECK (waitlist_hold_minutes BETWEEN 1 AND 1440);

-- ── 席（卓）版（旧 562。M3 の番号とぶつかるため 559 に1本化） ──

CREATE TABLE IF NOT EXISTS rt_seat_waitlist (
  id                    TEXT PRIMARY KEY,
  store_id              TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  starts_at             TEXT NOT NULL,
  guest_count           INTEGER NOT NULL CHECK (guest_count BETWEEN 1 AND 100),
  customer_name         TEXT NOT NULL,
  customer_phone        TEXT,
  line_uid              TEXT,
  -- 同じ開始時刻に同じ組が二度並べないための鍵（電話番号かLINE IDか名前）。
  identity_key          TEXT NOT NULL,
  -- waiting: 待っている / invited: 空きを知らせた（仮押さえ中）
  -- / converted: 予約になった / cancelled: 本人が取り消した
  status                TEXT NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting', 'invited', 'converted', 'cancelled')),
  hold_minutes          INTEGER NOT NULL DEFAULT 30 CHECK (hold_minutes BETWEEN 1 AND 1440),
  -- 招待したときに空いた席。組の人数が入る席だけを候補にする。
  table_id              TEXT REFERENCES rt_tables(id) ON DELETE SET NULL,
  invited_at            TEXT,
  hold_expires_at       TEXT,
  -- LINE を送った時刻。LINE 未連携の組は店が電話するため NULL のまま。
  notified_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同じ開始時刻に同じ組は二度並べない（待っている・仮押さえ中だけ）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_seat_waitlist_slot_identity
  ON rt_seat_waitlist(store_id, starts_at, identity_key)
  WHERE status IN ('waiting', 'invited');

-- 空きが出たときに「先に並んだ組から」を引く。
-- 同着の並びは取り出し時の ORDER BY created_at, rowid で入れた順にする。
CREATE INDEX IF NOT EXISTS idx_rt_seat_waitlist_slot_created
  ON rt_seat_waitlist(store_id, starts_at, status, created_at);

CREATE TABLE IF NOT EXISTS rt_seat_visit_marks (
  id                    TEXT PRIMARY KEY,
  reservation_id        TEXT NOT NULL REFERENCES rt_reservations(id) ON DELETE CASCADE,
  store_id              TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  -- visited: 来店した / late: 遅れる / no_show: 来なかった
  kind                  TEXT NOT NULL CHECK (kind IN ('visited', 'late', 'no_show')),
  -- late のときだけ必須の遅れ分数。
  late_minutes          INTEGER CHECK (late_minutes IS NULL OR (late_minutes BETWEEN 1 AND 1440)),
  -- 付けた人（ログイン利用者）。監査の actor と同じ考え方で外部キーは付けない。
  marked_by_staff_id    TEXT,
  marked_by_name        TEXT,
  -- UTC ISO8601。付けた時刻。
  marked_at             TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'late' AND late_minutes IS NOT NULL)
      OR (kind != 'late' AND late_minutes IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_rt_seat_visit_marks_reservation
  ON rt_seat_visit_marks(reservation_id, marked_at DESC);

CREATE INDEX IF NOT EXISTS idx_rt_seat_visit_marks_store
  ON rt_seat_visit_marks(store_id, marked_at DESC);
