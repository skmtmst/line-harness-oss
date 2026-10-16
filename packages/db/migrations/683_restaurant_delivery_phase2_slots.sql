-- オーナー承認 2026-10-09（設計正本：デリバリー受注_v02.pen の D-1〜D-6）の受注基盤へ、
-- 2026-10-10 に利用者が事前共有したフェーズ2（LINE自社デリバリー受注＋配送アグリゲーション）の
-- 受け皿だけを足す。画面は1枚も増やさないため新しいデザイン承認は要らない。
-- 既存3サービス（Uber Eats・出前館・ロケットナウ）の受注の動きは変えない。
-- 足す理由：フェーズ2で表の作り直しが必要になると、稼働後に後戻りが出る。まだ使っていない今のうちに
-- 制約（CHECK）を広げておく。
-- migration-policy: table-rebuild

-- 1. 店舗ごとの機能の入り切り。
--    これまでは大枠の `restaurant_test` 1本しか無く、「この店舗はデリバリーだけ止める」が作れなかった。
--    切った店舗は管理画面のサイドメニューとリッチメニューの枠を隠し、LIFF直アクセスは案内文を出す。
--    config_json は閾値（自社配送へ切り替える基準金額・手数料率・配達最大半径・API優先度）の置き場。
--    閾値を足すときに表を作り直さずに済ませるために最初から持たせる。
CREATE TABLE IF NOT EXISTS rt_store_feature_flags (
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN (
    'delivery',              -- デリバリー受注そのもの
    'delivery_line_direct',  -- LINEからの自社受注（フェーズ2）
    'delivery_dispatch',     -- 配送を外部業者へ委託する（フェーズ2）
    'reservation',           -- 席の予約
    'coupon'                 -- クーポン
  )),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  config_json TEXT CHECK (config_json IS NULL OR json_valid(config_json)),
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, feature)
);
CREATE INDEX IF NOT EXISTS rt_store_feature_flags_feature
  ON rt_store_feature_flags(feature, enabled);

-- 2. 注文表に、注文の経路・配送を担う業者・配達の追跡・クーポンを持たせる。
--    `service` の制約に 'line' が無いため、LINEから直接受けた注文はそもそも入れられなかった。
--    ここだけは列の追加では直せない（SQLiteは CHECK を後から変えられない）ので作り直す。
CREATE TABLE rt_delivery_orders_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  -- 'line' を追加。LINEから直接受けた注文も同じ表に並べ、画面と日次売上を1本に保つ。
  service TEXT NOT NULL CHECK (service IN ('ubereats','demaecan','rocketnow','line')),
  external_order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','cooking','ready','handed_over','canceled','rejected')),
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  pickup_method TEXT,
  wanted_at INTEGER,
  customer_note TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('urgent','normal','watch')),
  urgency_reason TEXT,
  urgency_computed_at INTEGER,
  cancel_reason_code TEXT,
  canceled_by TEXT CHECK (canceled_by IS NULL OR canceled_by IN ('store','customer','service')),
  received_at INTEGER NOT NULL,
  accepted_at INTEGER,
  ready_at INTEGER,
  handed_over_at INTEGER,
  canceled_at INTEGER,
  -- 注文がどこから来たか。既存の3サービス経由は 'external'、LINEの自社注文は 'line_direct'。
  -- 既存行は 'external' のまま。手数料の考え方が違うので service とは別に持つ。
  order_source TEXT NOT NULL DEFAULT 'external'
    CHECK (order_source IN ('external','line_direct')),
  -- 配達を誰が運ぶか。'service'=そのサービスの配達員（既存）、'store'=店舗が自分で運ぶ、
  -- 'uber_direct'/'wolt_drive'=自社注文の配送委託先（フェーズ2）。未確定は NULL。
  delivery_provider TEXT CHECK (delivery_provider IS NULL OR delivery_provider IN (
    'service','store','uber_direct','wolt_drive'
  )),
  -- 委託先が払い出す配達の追跡ID。お客様への追跡案内と、失敗時の照会に使う。
  delivery_tracking_id TEXT,
  -- 委託先へ実際に払った配送実費（円）。サービスの手数料と比べて得かどうかを
  -- 後から数字で示すために、注文の行に残す。外部サービス経由の注文では NULL。
  delivery_fee_amount INTEGER CHECK (delivery_fee_amount IS NULL OR delivery_fee_amount >= 0),
  -- 自動適用したクーポン。金額の内訳を後から説明できるようにする。
  coupon_id TEXT,
  -- 注文したお客様（友だち）。LINEから直接受けた注文に後続の配信やタグ付けを繋げるため。
  -- 外部サービス経由の注文は相手のIDを貰えないので NULL。本人が特定できる前の
  -- 下書き段階でも入れられるよう、NULL を許す。
  friend_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (service, external_order_id),
  -- 外部サービス経由の注文に委託配送は付かない。経路と業者の食い違いを表の側で止める。
  CHECK (order_source = 'line_direct' OR delivery_provider IS NULL OR delivery_provider IN ('service','store')),
  CHECK (order_source = 'external' OR service = 'line')
);
INSERT INTO rt_delivery_orders_new (
  id, account_id, store_id, service, external_order_id, order_number, status,
  total_amount, currency, item_count, pickup_method, wanted_at, customer_note,
  urgency, urgency_reason, urgency_computed_at, cancel_reason_code, canceled_by,
  received_at, accepted_at, ready_at, handed_over_at, canceled_at,
  version, created_at, updated_at
)
SELECT
  id, account_id, store_id, service, external_order_id, order_number, status,
  total_amount, currency, item_count, pickup_method, wanted_at, customer_note,
  urgency, urgency_reason, urgency_computed_at, cancel_reason_code, canceled_by,
  received_at, accepted_at, ready_at, handed_over_at, canceled_at,
  version, created_at, updated_at
FROM rt_delivery_orders;
DROP TABLE rt_delivery_orders;
ALTER TABLE rt_delivery_orders_new RENAME TO rt_delivery_orders;
-- 索引は表と一緒に消えるため作り直す。並び順と役割は 635 と同じ。
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_status
  ON rt_delivery_orders(store_id, status, received_at);
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_received
  ON rt_delivery_orders(store_id, received_at);
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_service_received
  ON rt_delivery_orders(store_id, service, received_at);
-- 経路ごとの集計（自社注文の件数・売上）を店舗別に引くための索引。
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_source_received
  ON rt_delivery_orders(store_id, order_source, received_at);
-- 「このお客様の注文履歴」を引くための索引。friend_id が NULL の行（外部サービス経由）は
-- 索引に入れず、自社注文だけを対象にする。
CREATE INDEX IF NOT EXISTS rt_delivery_orders_friend_received
  ON rt_delivery_orders(friend_id, received_at)
  WHERE friend_id IS NOT NULL;
