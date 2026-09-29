-- 472: アフィリエイトの案件の決まりの版 (#823)。
-- 保存するたびに1行足す。前の版は変えない（追記だけ。UPDATE・DELETE しない）。
-- 「この版に戻す」はこの表の行を変えず、その中身で新しい版を作る。
-- 使い始めの日時 (effective_from) を版ごとに持てる。空なら公開と同時。
-- 成果の承認時は、その時点の版を報酬の計算根拠に写す。版を変えても過去の付与は変わらない。
-- 数える期間 (window_days) は 1〜365 日、既定 30 日。
-- 上限 (cap_total: 案件全体 / cap_monthly_per_affiliate: 1人あたり月) に達したら
-- 受付を自動で止め、紹介した人の画面にも出す。
CREATE TABLE IF NOT EXISTS affiliate_offer_versions (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES affiliate_offers(id),
  version_number INTEGER NOT NULL,
  -- 1件あたりの報酬。固定額(円)とマイル。
  reward_amount INTEGER NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
  reward_miles INTEGER NOT NULL DEFAULT 0 CHECK (reward_miles >= 0),
  -- リンクを開いてから数える期間(日)。既定 30。
  window_days INTEGER NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 365),
  -- 上限。空は「上限なし」。上限に達したら受付を自動で止める。
  cap_total INTEGER CHECK (cap_total IS NULL OR cap_total > 0),
  cap_monthly_per_affiliate INTEGER CHECK (cap_monthly_per_affiliate IS NULL OR cap_monthly_per_affiliate > 0),
  -- 受付の期間。空の端は「区切りなし」。期間外の紹介には成果を付けない。
  reception_from TEXT,
  reception_to TEXT,
  -- 使い始めの日時。空は「公開と同時」。未来の日時は「予約」の札で見せる。
  effective_from TEXT,
  created_by_staff_id TEXT,
  -- 同じ確認キーの再送では版を増やさないための鍵。
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (offer_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_offer_versions_offer
  ON affiliate_offer_versions (offer_id, version_number DESC);

-- 既存の案件は、いまの報酬・期間30日・上限なし・受付期間なしを第1版として残す。
-- 黙って付け直さない。新しい成果から、その時点で使っている版を見る。
INSERT OR IGNORE INTO affiliate_offer_versions
  (id, offer_id, version_number, reward_amount, reward_miles, window_days,
   cap_total, cap_monthly_per_affiliate, reception_from, reception_to,
   effective_from, created_at)
SELECT lower(hex(randomblob(16))), id, 1, reward_amount, reward_miles, 30,
   NULL, NULL, NULL, NULL,
   NULL, created_at
  FROM affiliate_offers;
