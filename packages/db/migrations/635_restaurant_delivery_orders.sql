-- Owner approved 2026-10-09: 飲食店向け（テスト）「デリバリー受注」の受注基盤。
-- 設計正本：デリバリー受注_v02.pen の D-1 `kDQHr` / D-2 `hjdqV` / D-3 `dgeTy` / D-4 `OzHLO` / D-5 `h7OeT` / D-6 `XCVGd`。
-- Additive only; 既存の予約・在庫・Google連携の表は一切変更しない。
-- 対象サービスは Uber Eats・出前館・ロケットナウの3つ（menu は2026-09-30終了のため対象外）。
-- 外部の受注一元化サービス（Camel等）との契約・通信はない。各サービスの公式窓口から自社Workerが直接受け取る。

-- 共通形式へ変換した注文。管理画面の表・履歴・日次売上はすべてこの表が正体。
CREATE TABLE IF NOT EXISTS rt_delivery_orders (
  id TEXT PRIMARY KEY,
  -- 店舗は account_id → rt_stores.line_account_id と統括で引く。組織IDだけで信用しない。
  account_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('ubereats','demaecan','rocketnow')),
  -- サービス側の注文ID。再送・重複受信をここで吸収する。
  external_order_id TEXT NOT NULL,
  -- 画面に出す注文番号（#UE-1042 など）。桁揃えはサービスごとに違うため文字列で持つ。
  order_number TEXT NOT NULL,
  -- 新着 → 調理中 → 準備完了 → 受け渡し済み。キャンセル・拒否は終端。
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','cooking','ready','handed_over','canceled','rejected')),
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  -- 受け取り情報（D-2）。「配達（Uber Eats 配達員）」のような表示文をそのまま持つ。
  pickup_method TEXT,
  wanted_at INTEGER,
  customer_note TEXT,
  -- 急ぎ度はバックエンドだけで判定する。画面には結果と理由だけを出す（判定の仕組み名は出さない）。
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('urgent','normal','watch')),
  urgency_reason TEXT,
  urgency_computed_at INTEGER,
  -- キャンセルは理由と発生元を残す。取り消せない操作なので履歴から消さない。
  cancel_reason_code TEXT,
  canceled_by TEXT CHECK (canceled_by IS NULL OR canceled_by IN ('store','customer','service')),
  received_at INTEGER NOT NULL,
  accepted_at INTEGER,
  ready_at INTEGER,
  handed_over_at INTEGER,
  canceled_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (service, external_order_id)
);
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_status
  ON rt_delivery_orders(store_id, status, received_at);
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_received
  ON rt_delivery_orders(store_id, received_at);
CREATE INDEX IF NOT EXISTS rt_delivery_orders_store_service_received
  ON rt_delivery_orders(store_id, service, received_at);

-- 注文の品目（D-2の「注文内容」とD-1/D-4の要約文の素）。
CREATE TABLE IF NOT EXISTS rt_delivery_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  name TEXT NOT NULL,
  -- 「特製タレ増量（無料）」のような補足行。無ければ NULL。
  note TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (order_id, position)
);
CREATE INDEX IF NOT EXISTS rt_delivery_order_items_order
  ON rt_delivery_order_items(order_id, position);

-- 受信台帳。署名検証を通った通知を先にここへ記録し、同じ通知を二重に処理しない。
CREATE TABLE IF NOT EXISTS rt_delivery_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('ubereats','demaecan','rocketnow')),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processed','failed','retryable_failed','ignored')),
  -- 共通形式へ変換する前の本文。再処理に使う。サービスから返った自由文のエラー本文は入れない。
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (service, external_event_id)
);
CREATE INDEX IF NOT EXISTS rt_delivery_events_status
  ON rt_delivery_events(status, received_at);
CREATE INDEX IF NOT EXISTS rt_delivery_events_account
  ON rt_delivery_events(account_id, received_at);

-- 店舗×サービスの接続状況と受付状況（D-1のサービスカード、D-6の一括停止）。
CREATE TABLE IF NOT EXISTS rt_delivery_service_states (
  account_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('ubereats','demaecan','rocketnow')),
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('connected','disconnected','error')),
  intake_status TEXT NOT NULL DEFAULT 'open' CHECK (intake_status IN ('open','stopped')),
  -- 受付停止の自動再開時刻（30分・60分・90分・本日中）。停止していない間は NULL。
  stop_until INTEGER,
  stop_requested_at INTEGER,
  stop_requested_by TEXT,
  resumed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, service),
  CHECK (intake_status = 'stopped' OR stop_until IS NULL)
);
CREATE INDEX IF NOT EXISTS rt_delivery_service_states_due
  ON rt_delivery_service_states(intake_status, stop_until);

-- 品切れ一括設定（D-5）の商品。1回の操作で3サービスへまとめて反映する。
CREATE TABLE IF NOT EXISTS rt_delivery_menu_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  sold_out INTEGER NOT NULL DEFAULT 0 CHECK (sold_out IN (0,1)),
  sold_out_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- サービスごとの商品ID（{"ubereats":"...","demaecan":"..."}）。未連携は入れない。
  external_item_ids_json TEXT
    CHECK (external_item_ids_json IS NULL OR json_valid(external_item_ids_json)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, name)
);
CREATE INDEX IF NOT EXISTS rt_delivery_menu_items_store
  ON rt_delivery_menu_items(store_id, sort_order);
CREATE INDEX IF NOT EXISTS rt_delivery_menu_items_sold_out
  ON rt_delivery_menu_items(store_id, sold_out, sort_order);

-- 送信台帳。各サービスAPIへの送信は必ずここへ記録し、成功した時だけ注文・商品の状態を進める。
CREATE TABLE IF NOT EXISTS rt_delivery_dispatches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('ubereats','demaecan','rocketnow')),
  action TEXT NOT NULL CHECK (action IN (
    'accept','reject','ready','handed_over','cancel',
    'menu_sold_out','menu_resume','intake_stop','intake_resume'
  )),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('order','menu_item','service')),
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','retryable_failed','exhausted')),
  -- 失敗は分類済みの符号だけを残す。サービスから返った自由文・本文・例外は保存しない。
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER,
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rt_delivery_dispatches_due
  ON rt_delivery_dispatches(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS rt_delivery_dispatches_target
  ON rt_delivery_dispatches(target_kind, target_id, requested_at);
