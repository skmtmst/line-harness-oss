-- V8: サイト別の最終受信。検証・本番適用はオーナー承認待ち。
ALTER TABLE measurement_sites ADD COLUMN last_received_at TEXT;
