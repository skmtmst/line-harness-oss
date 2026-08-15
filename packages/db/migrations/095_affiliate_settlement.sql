-- アフィリエイターの連絡先と支払い条件。
-- 報酬額は affiliate_offers 側で持つが、支払いの取り決めは人に紐づく。

ALTER TABLE affiliates ADD COLUMN email TEXT;

-- 成果が確定するまでの保留日数（返品・キャンセルを見る期間）。NULL なら即確定。
ALTER TABLE affiliates ADD COLUMN hold_days INTEGER;

-- 支払いサイクルの覚書。計算には使わず、運用の取り決めを残すための欄。
ALTER TABLE affiliates ADD COLUMN payout_cycle TEXT;

-- 成果が出たときに本人へ知らせるか。既定は知らせない（従来どおり）。
ALTER TABLE affiliates ADD COLUMN notify_on_conversion INTEGER NOT NULL DEFAULT 0;
