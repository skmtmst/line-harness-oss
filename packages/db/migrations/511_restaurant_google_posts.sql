-- 飲食店向け「Googleビジネス」第3段（投稿）。第1段(446)・第2段(447)の表は変更しない。
-- rt_gbp_posts（168の旧表）はCHECK制約が新設計と合わず、旧経路(/api/restaurant-test/gbp/posts)専用のまま残す。
-- こちらは読まない・書かない・消さない。
--
-- Google の Local Posts API には作成用の冪等キーが無く、送信は毎回新規投稿になる。
-- そのため送信結果が不明なときは status=pending_confirm のまま残し、次回の操作時に
-- Google の一覧と content_fingerprint（送信内容の指紋）を突き合わせて確定させる
-- （第2段の base_fingerprint と同じ考え方だが、役割は「競合検出」ではなく「重複検出」）。
--
-- additive-only規約でCHECKは後から広げられない。446→447で write_log.kind のCHECKを
-- 広げられずテーブルを増やすしかなくなった経緯があるため、第3段で未使用の値
-- （publish_mode='scheduled', status='scheduled'/'deleted' 等）も最初から入れておく。
--
--   kind:   standard（最新情報）/ event（イベント）/ offer（特典）/ alert（Google側で新規作成終了、将来の取り込み用）
--   origin: admin（この画面で作った）/ google（Googleの管理画面等で作られ、取り込んだ）
--   publish_mode: now（今すぐ）/ scheduled（日時指定。第3段では受け付けない。器だけ用意）
--   status: draft（下書き）/ scheduled（予約。第3段では使わない）/ pending_confirm（送信結果が不明）
--           / accepted（Googleが受理・審査中=PROCESSING）/ published（公開中=LIVE）
--           / rejected（Googleが不承認=REJECTED）/ failed（送信失敗）/ cancelled（下書きの取り消し）
--           / deleted（Googleから削除した、またはGoogle側で消えたのを検知した）
--   google_state は Google が返した state の原文。status はそれを画面の言葉に写したもの。
CREATE TABLE IF NOT EXISTS rt_google_posts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('standard', 'event', 'offer', 'alert')),
  origin TEXT NOT NULL DEFAULT 'admin' CHECK (origin IN ('admin', 'google')),

  -- 本文・タイトル（イベント／特典はタイトル必須。最新情報は空文字のまま使わない）
  summary TEXT NOT NULL DEFAULT '',
  title TEXT,

  -- イベント／特典の期間。Google の TimeInterval は日付と時刻が別項目なので分けて持つ。
  -- タイムゾーンは店舗の所在地に合わせてGoogle側が解釈する（既定Asia/Tokyo）。
  event_start_date TEXT,
  event_start_time TEXT,
  event_end_date TEXT,
  event_end_time TEXT,

  -- ボタン。特典（offer）ではGoogleが無視するため送らない（画面にも出さない）。
  cta_type TEXT CHECK (cta_type IN ('none', 'book', 'order', 'shop', 'learn_more', 'sign_up', 'call')),
  cta_url TEXT,

  -- 特典だけの項目（いずれも任意）
  coupon_code TEXT,
  redeem_online_url TEXT,
  terms_conditions TEXT,

  -- 画像。[{ mediaId, filename, sourceUrl }] のJSON配列。第3段は社内の登録メディアから1枚まで。
  -- Local Posts の media は sourceUrl のみ対応のため、登録メディアの公開URLをそのまま入れる。
  media_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(media_json)),

  publish_mode TEXT NOT NULL DEFAULT 'now' CHECK (publish_mode IN ('now', 'scheduled')),
  publish_at TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'pending_confirm', 'accepted', 'published',
                      'rejected', 'failed', 'cancelled', 'deleted')),

  -- Google 側の識別子。accounts/{account}/locations/{location}/localPosts/{id} の形。
  google_post_name TEXT,
  google_state TEXT,
  search_url TEXT,
  google_create_time TEXT,
  google_update_time TEXT,

  -- 送信内容の指紋（SHA-256先頭32文字）。送信結果が不明なとき、Googleの一覧から
  -- 自分が出した投稿を見つけて二重投稿を避けるための照合キー。
  content_fingerprint TEXT,
  request_id TEXT,

  staff_id TEXT,
  staff_name TEXT,
  error TEXT,

  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  sent_at TEXT,
  published_at TEXT,
  checked_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_rt_google_posts_store ON rt_google_posts(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_google_posts_status ON rt_google_posts(store_id, status);
-- 同じGoogle投稿を2行に増やさない。取り込み（sync）のUPSERTの土台。
CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_google_posts_google_name
  ON rt_google_posts(store_id, google_post_name) WHERE google_post_name IS NOT NULL;
-- 送信結果が不明な行の照合を速くする。
CREATE INDEX IF NOT EXISTS idx_rt_google_posts_fingerprint
  ON rt_google_posts(store_id, content_fingerprint) WHERE content_fingerprint IS NOT NULL;
