-- L (#824 ダッシュボードの数字の出どころ): 出どころ集計の索引。
--
-- ダッシュボードは「LINEアカウント×状態×出どころ×失敗時刻」で
-- 送達台帳を読む。474 の source 欄と合わせて使う。

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_origin
  ON notification_deliveries(line_account_id, status, source, failed_at DESC);
