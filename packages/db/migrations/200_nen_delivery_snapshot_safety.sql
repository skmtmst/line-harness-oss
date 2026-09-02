-- NEN配信は予約時の本文を固定する。設定の後編集で待機中jobを書き換えない。
ALTER TABLE nen_delivery_jobs ADD COLUMN campaign_snapshot TEXT CHECK (
  campaign_snapshot IS NULL OR json_valid(campaign_snapshot)
);

-- 既存の待機jobは、移行時点の設定を第1スナップショットとして固定する。
UPDATE nen_delivery_jobs
   SET campaign_snapshot = (
     SELECT json_object(
       'campaign_key', s.campaign_key,
       'label', s.label,
       'category', s.category,
       'delay_days', s.delay_days,
       'delivery_time', s.delivery_time,
       'is_enabled', s.is_enabled,
       'title', s.title,
       'body_text', s.body_text,
       'button_label', s.button_label,
       'button_url', s.button_url,
       'image_url', s.image_url
     )
       FROM nen_campaign_settings s
      WHERE s.campaign_key = nen_delivery_jobs.campaign_key
   )
 WHERE campaign_snapshot IS NULL
   AND status IN ('pending', 'failed', 'processing');
