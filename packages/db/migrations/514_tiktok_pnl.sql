-- TikTok利益計算の自動化（第2段＝API連携）。
--
-- EC-CUBE 側の `dtb_nen_tiktok_order`（TikTok Shop 注文の生データ）を
-- 読み取り専用エンドポイント経由で取り込み、利益計算用スプレッドシートの
-- 「注文明細（自動）」タブへ書き出すための持ち場。
-- 金額計算（原価・報酬・手数料・送料・ランク判定）は worker では行わず、
-- すべてスプレッドシート側の数式に任せる。worker が書くのは生の明細だけ。

-- TikTok注文の明細行。1行 = 1注文内の1商品。
CREATE TABLE IF NOT EXISTS tiktok_pnl_order_lines (
  -- `<TikTok注文ID>:<行番号>`。シートのキー列（A列）にもこの値を使う。
  line_key TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  tiktok_order_id TEXT NOT NULL,
  line_index INTEGER NOT NULL,
  -- 集計の基準日（JST）。支払日、なければ注文日から求める。YYYY-MM-DD。
  order_date_jst TEXT NOT NULL,
  paid_at TEXT,
  -- EC側から届いた生のステータス。表示用の日本語化は書き出し時に行う。
  order_status TEXT,
  sku TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_yen INTEGER,
  line_amount_yen INTEGER,
  -- 同日・同一購入者を1発送と数えるための識別子（EC側で正規化済み）。
  buyer_key TEXT,
  source_updated_at TEXT,
  fetched_at TEXT NOT NULL,
  -- 1 = シートへ未反映（新規または内容が変わった）。書き出し成功で 0 に戻す。
  sheet_dirty INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tiktok_pnl_lines_account_date
  ON tiktok_pnl_order_lines(line_account_id, order_date_jst);
CREATE INDEX IF NOT EXISTS idx_tiktok_pnl_lines_dirty
  ON tiktok_pnl_order_lines(line_account_id, sheet_dirty);

-- アカウントごとの利益計算シートの状態。Google の認可は既存の
-- google_sheets_integrations（#838）の refresh_token を使い回すため、
-- ここにはトークンを持たない。シートは worker が雛形から自動作成する。
CREATE TABLE IF NOT EXISTS tiktok_pnl_settings (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  spreadsheet_id TEXT,
  spreadsheet_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'error')),
  -- EC側取り込みの再開点（source_updated_at ベース）。
  import_cursor TEXT,
  last_import_at TEXT,
  last_sheet_sync_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
