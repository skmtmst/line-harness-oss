-- Q（機能）: 共通情報の状態「下書き・使用中・止めた・期限切れ」と、期限14日前・3日前の通知記録。
-- 「期限切れ」は有効終了時刻からその都度計算するため列は持たない（時刻だけ変わっても行は書き換えない）。
-- 既存行はすべて使用中として引き継ぐ（status の DEFAULT 'active'）。
ALTER TABLE common_vars ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('draft', 'active', 'stopped'));
ALTER TABLE common_vars ADD COLUMN stopped_at TEXT;
-- 期限の通知は1回だけ送る。送った側を時刻で記録し、期限を延ばした場合は保存側で消す。
ALTER TABLE common_vars ADD COLUMN expiry_notice_14_at TEXT;
ALTER TABLE common_vars ADD COLUMN expiry_notice_3_at TEXT;
