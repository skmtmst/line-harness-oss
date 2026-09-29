-- L (#824 ダッシュボードの数字の出どころ): 通知の台帳の送達行に「出どころ」の欄を足す。
--
-- ダッシュボードの失敗の数は、この台帳から数える。同じ失敗は通知インスタンス
-- 1件として数え、送り直し(execution_mode='retry'/'resend'/'test')は数えない。
-- 出どころは親インスタンスの source_event_type を写す。送達行だけ見て
-- 「どの台帳から・何の失敗か」が分かるようにし、JOINなしで集計できる。
-- 新しい行の source は送達を作る側が入れる。既存行は親から埋める。

ALTER TABLE notification_deliveries ADD COLUMN source TEXT;

-- 既存行の救済: 親インスタンスの source_event_type を写す。
-- 親が無い行(壊れた参照)は NULL のままにし、推測で埋めない。
UPDATE notification_deliveries
SET source = (
  SELECT i.source_event_type
  FROM notification_instances i
  WHERE i.id = notification_deliveries.instance_id
)
WHERE source IS NULL;
