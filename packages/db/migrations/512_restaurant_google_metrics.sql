-- 飲食店向け「Googleビジネス」第4段（パフォーマンス表示＋定期再同期）。
-- 第1〜3段（446/447/511）の表は変更しない（rt_google_connections への列追加のみ）。
--
-- Google Business Profile Performance API（businessprofileperformance.googleapis.com）の
-- 日次集計値を深夜1回の定期実行で取り込み、この表に蓄積する。画面はこの表だけを読む
-- （表示のたびに Google を呼ばない）。Google 側の集計は3〜5日遅れで確定するため、
-- 直近数日ぶんは毎回上書きして追随する。
--
-- 値は「未取得」と「0件」を区別するため NULL 許可の INTEGER。画面は NULL を「—」で出す。
-- 表示回数（プロフィール表示）は impressions_* 4列の合計。列は端末×面の区分別に持ち、
-- 将来の内訳表示に備える。指標の追加は additive-only 規約どおり列追加で行う。
CREATE TABLE IF NOT EXISTS rt_google_metrics_daily (
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                       -- YYYY-MM-DD（店舗所在地の暦日。Googleの日次区切りに従う）

  -- プロフィール表示（Business Impressions）の内訳
  impressions_desktop_maps INTEGER,
  impressions_desktop_search INTEGER,
  impressions_mobile_maps INTEGER,
  impressions_mobile_search INTEGER,

  -- 行動（クリック等）
  direction_requests INTEGER,               -- ルート検索
  call_clicks INTEGER,                      -- 電話ボタンのクリック（通話成立数ではない）
  website_clicks INTEGER,                   -- サイトへのクリック

  -- 飲食店向け
  menu_clicks INTEGER,                      -- メニュー閲覧
  bookings INTEGER,                         -- Google経由の予約（連携サービス未対応の店舗は NULL）
  food_orders INTEGER,                      -- 料理の注文（同上）

  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (store_id, date)
);

CREATE INDEX IF NOT EXISTS idx_rt_google_metrics_daily_store_date
  ON rt_google_metrics_daily(store_id, date DESC);

-- 定期実行のゲート用時刻。既存の last_synced_at は口コミ同期専用のまま共用しない。
ALTER TABLE rt_google_connections ADD COLUMN last_posts_synced_at TEXT;
ALTER TABLE rt_google_connections ADD COLUMN last_metrics_synced_at TEXT;
