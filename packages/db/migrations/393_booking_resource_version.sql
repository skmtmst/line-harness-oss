-- N-406 3B: 予約資源の管理画面更新を楽観ロックで守る。
ALTER TABLE booking_resources
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
