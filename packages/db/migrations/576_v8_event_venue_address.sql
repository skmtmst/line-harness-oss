-- V8: 会場名とは別に住所を保存する。検証・本番適用はオーナー承認待ち。
ALTER TABLE events ADD COLUMN venue_address TEXT;
