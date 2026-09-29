-- Issue #1037 (IDEA-19): 外部受信の検証フラグ。
--
-- 連携先システムが `POST /api/conversions/ingest/:id` へ `"test": true` を
-- 付けて送った受信は、検証としてここにだけ残す。成果表(conversion_events)
-- には書かないため、売上・報酬・集計には一切混入しない。
-- 既存の受信はすべて本番扱いなので既定は 0。

ALTER TABLE conversion_ingestion_events
  ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
