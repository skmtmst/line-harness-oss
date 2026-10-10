-- 候補547: 版lock backfill＋編集receipt（V8-02 versioned save）
--
-- 将来の承認文（テンプレート。今回は承認要求しない）:
--   番号: 候補547（promotion直前に最新base＋公開PRと再確認）
--   列/表: rich_menu_groups / event_bookings / scenarios / auto_replies に
--     lock_version を追加（整数・非負CHECK付き。新規列・既定値 backfill）。
--     bookings は現行 lock_version あり（298）のため重複追加しない。
--     auto_reply_versions.version_number は公開版番号（別意味）のため
--     置換しない。tenants は 544 の revision が版正本のため触らない
--     （二重正本にしない）。新規表 v8_edit_receipts を1つ作る。
--   既存データ影響: 既存行は lock_version=0 のまま。意味は変えない。
--     -1・小数はCHECKで拒否する。
--   対象環境: 開発・検証（本番は対象外）。
--   バックアップ/戻し方: 547_version_lock_backfill_rollback.sql（論理
--     rollback第一案。列・receiptは残す。物理復元は別承認・保守時間・
--     後続保全が条件。短いSQLで戻せるとは言わない）。
--   539〜543未承認、538拒否済み。適用は承認後の別工程（今回は草稿のみ）.

ALTER TABLE rich_menu_groups ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(lock_version) = 'integer' AND lock_version >= 0);
ALTER TABLE event_bookings ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(lock_version) = 'integer' AND lock_version >= 0);
ALTER TABLE scenarios ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(lock_version) = 'integer' AND lock_version >= 0);
ALTER TABLE auto_replies ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(lock_version) = 'integer' AND lock_version >= 0);

-- 編集用 operation receipt。CAS成功（changes=1）の直後に1行作り、
-- 後続の子・history・監査・outbox をこの receipt で guard する。
-- 単なる EXISTS(resource id) は CAS失敗時も真になるため使わない。
-- ヘッダ Idempotency-Key と fresh opID/hash/tenant/account/actor/
-- resource/method の scope を結び、同scope再送の replay 応答を保存する。
CREATE TABLE IF NOT EXISTS v8_edit_receipts (
  op_id TEXT PRIMARY KEY CHECK (op_id IS NOT NULL),
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT REFERENCES line_accounts(id),
  -- 正規化scope。NULLは 'none:'、実IDは 'account:'＋IDで区別する
  -- （COALESCE global では実global IDと衝突するため）。
  -- pathはクエリなしの正規化path。要求identityと完全一致させる。
  account_scope TEXT GENERATED ALWAYS AS
    (CASE WHEN line_account_id IS NULL THEN 'none:' ELSE 'account:' || line_account_id END)
    STORED NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('PUT', 'PATCH', 'POST')),
  path TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  -- 補正（02複合版対応）: templatesは (published_version, draft_revision) の組が
  -- 版正本。公開でdraft_revisionが0へ戻るため、単一version列では公開前draft1と
  -- 公開後draft1が衝突する。version_epoch に公開版を入れ、version に下書き版を
  -- 入れる（templates以外は epoch 0）。templates既存2列の変更・UNIQUE削除はしない。
  version_epoch INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(version_epoch) = 'integer' AND version_epoch >= 0),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 0),
  request_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  replay_response_json TEXT NOT NULL DEFAULT '{"state":"pending"}'
    CHECK (json_valid(replay_response_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (resource_kind, resource_id, tenant_id, account_scope, version_epoch, version),
  UNIQUE (tenant_id, account_scope, resource_kind, resource_id, method, path, idempotency_key, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_v8_edit_receipts_resource
  ON v8_edit_receipts (resource_kind, resource_id);
