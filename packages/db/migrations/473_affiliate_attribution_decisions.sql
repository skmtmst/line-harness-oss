-- 473: アフィリエイトの成果の付け方の記録 (#823)。
-- 候補になった紹介を並べ、どの決まりで誰に付けたかを1件ずつ説明できる表。
-- 付けなかった紹介には、その理由を残す。
-- conversion_event_id は一意。同じ成果に2人分は付けない。
-- 付け直しはこの行を書き換えず、理由付きの調整(adjustment)で足す。
CREATE TABLE IF NOT EXISTS affiliate_attribution_decisions (
  id TEXT PRIMARY KEY,
  conversion_event_id TEXT NOT NULL UNIQUE REFERENCES conversion_events(id),
  friend_id TEXT NOT NULL,
  conversion_point_id TEXT NOT NULL,
  -- 付けた先。付けなかったときは空。
  affiliate_id TEXT REFERENCES affiliates(id),
  ref_code TEXT,
  offer_id TEXT REFERENCES affiliate_offers(id),
  -- 判断に使った案件の版。版を変えてもこの記録は変わらない。
  offer_version_id TEXT REFERENCES affiliate_offer_versions(id),
  -- 判断の理由。画面には人の言葉で出す。
  reason TEXT NOT NULL CHECK (reason IN (
    'matched_last_touch',
    'no_touch',
    'out_of_window',
    'self_referral',
    'inactive_link',
    'inactive_affiliate',
    'other_account',
    'reception_closed',
    'capped_total',
    'capped_monthly'
  )),
  -- 判断に使った数える期間(日)。案件の版があればその値、なければ全体の既定。
  window_days INTEGER NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  -- 候補になった紹介の写し(JSON)。紹介者名・案件名・開いた時刻・結果を
  -- 判断の時点で残す。後から名前が変わっても、この記録は書き換えない。
  candidates_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_decisions_offer
  ON affiliate_attribution_decisions (offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_decisions_friend
  ON affiliate_attribution_decisions (friend_id, created_at DESC);
