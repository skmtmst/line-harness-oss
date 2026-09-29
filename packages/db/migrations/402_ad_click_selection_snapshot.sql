-- 媒体ごとの広告クリックIDをaccount・同意・期限つきで選び、
-- 初回の選択結果をoutboxへ固定して再試行中に差し替わらないようにする。

ALTER TABLE ref_tracking ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
ALTER TABLE ref_tracking ADD COLUMN ad_conversion_consent_at TEXT;

-- 旧行は記録時点のaccountも同意も証明できないため補完しない。
-- NULLのまま媒体選択から外し、現在所属を過去へ遡って推測しない。

CREATE INDEX IF NOT EXISTS idx_ref_tracking_ad_click_scope
  ON ref_tracking(friend_id, line_account_id, created_at DESC);

ALTER TABLE ad_conversion_outbox ADD COLUMN ref_tracking_id TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN click_id TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN click_id_type TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN click_recorded_at TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN click_expires_at TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN click_consent_at TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN click_context_json TEXT;
ALTER TABLE ad_conversion_outbox ADD COLUMN selection_reason TEXT NOT NULL DEFAULT 'legacy_unsnapshotted';
ALTER TABLE ad_conversion_outbox ADD COLUMN is_retryable INTEGER NOT NULL DEFAULT 1
  CHECK (is_retryable IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_ad_conversion_outbox_retryable_due
  ON ad_conversion_outbox(is_retryable, status, next_attempt_at);
