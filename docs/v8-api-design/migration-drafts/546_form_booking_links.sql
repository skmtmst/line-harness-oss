-- 候補546: 回答↔予約の対応づけ＋予約用claim（V8-03 form booking）
--
-- 将来の承認文（テンプレート。今回は承認要求しない）:
--   番号: 候補546（promotion直前に最新base＋公開PRと再確認）
--   列/表: 新規2表のみ。既存の forms / bookings / form_submit_claims /
--     outbox 表の変更なし。別 operations 表は作らない（予約用claimに
--     snapshot/owner/version/lease/steps/status/照会hashを統一）。
--   既存データ影響: 既存行の変更なし。新規表は空で始まる。
--   対象環境: 開発・検証（本番は対象外）。
--   バックアップ/戻し方: 546_form_booking_links_rollback.sql（論理
--     rollback第一案。表は残す。物理復元は別承認・保守時間・後続保全
--     が条件。短いSQLで戻せるとは言わない）。
--   539〜543未承認、538拒否済み。適用は承認後の別工程（今回は草稿のみ）。

-- 予約用claim。受付時の安定snapshot・所有者・版・lease・工程・状態・
-- 照会キーハッシュを1行に統一する。既存 form_submit_claims は公開版列
-- なし・回答用status値のため流用しない。friend は必須（別回答者の
-- 同キー衝突を複合scopeで防ぐ）。固定公開版の同キー再送は本表で返す。
CREATE TABLE IF NOT EXISTS form_booking_claims (
  id TEXT PRIMARY KEY CHECK (id IS NOT NULL),
  op_id TEXT NOT NULL UNIQUE CHECK (op_id IS NOT NULL),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  form_id TEXT NOT NULL REFERENCES forms(id),
  form_version_id TEXT NOT NULL REFERENCES form_versions(id),
  friend_id TEXT NOT NULL REFERENCES friends(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  definition_snapshot_json TEXT NOT NULL CHECK (json_valid(definition_snapshot_json)),
  lookup_key_hash TEXT NOT NULL,
  owner TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  lease_generation INTEGER NOT NULL DEFAULT 1 CHECK (typeof(lease_generation) = 'integer' AND lease_generation >= 1),
  steps TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(steps) AND json_type(steps) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'committed', 'compensating', 'failed')),
  submission_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (tenant_id, line_account_id, form_id, friend_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_form_booking_claims_lookup
  ON form_booking_claims (lookup_key_hash);

CREATE TABLE IF NOT EXISTS form_booking_links (
  id TEXT PRIMARY KEY CHECK (id IS NOT NULL),
  claim_id TEXT NOT NULL UNIQUE REFERENCES form_booking_claims(id) ON DELETE RESTRICT,
  op_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  form_id TEXT NOT NULL REFERENCES forms(id),
  form_version_id TEXT NOT NULL REFERENCES form_versions(id),
  friend_id TEXT NOT NULL REFERENCES friends(id),
  submission_id TEXT NOT NULL UNIQUE REFERENCES form_submissions(id) ON DELETE RESTRICT,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'committed', 'compensating', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (tenant_id, line_account_id, form_id, friend_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_form_booking_links_booking
  ON form_booking_links (booking_id);

-- claim自身のINSERT所属trigger。版・form・account・friendの帰属が
-- 食い違うclaim行を作らせない。
CREATE TRIGGER IF NOT EXISTS trg_form_booking_claims_affiliation
BEFORE INSERT ON form_booking_claims
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'claim scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM form_versions fv
    JOIN line_accounts la ON la.id = NEW.line_account_id
    JOIN friends fr ON fr.id = NEW.friend_id
    WHERE fv.id = NEW.form_version_id
      AND fv.form_id = NEW.form_id
      AND EXISTS (
        SELECT 1 FROM form_accounts fa
        WHERE fa.form_id = NEW.form_id AND fa.line_account_id = NEW.line_account_id
      )
      AND la.tenant_id = NEW.tenant_id
      AND fr.line_account_id = NEW.line_account_id
  );
END;

-- 所属整合trigger。claim/回答/予約/版/accountの tenant・account・form・
-- 版・friend が食い違う行は INSERT させずSQLエラーにする。
-- 0行時の後JS throwは不要。
CREATE TRIGGER IF NOT EXISTS trg_form_booking_links_affiliation
BEFORE INSERT ON form_booking_links
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'link/claim/submission/booking scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM form_booking_claims c
    JOIN form_submissions s ON s.id = NEW.submission_id
    JOIN bookings b ON b.id = NEW.booking_id
    JOIN form_versions fv ON fv.id = NEW.form_version_id
    JOIN line_accounts la ON la.id = NEW.line_account_id
    WHERE c.id = NEW.claim_id
      AND c.op_id = NEW.op_id
      AND c.tenant_id = NEW.tenant_id
      AND c.line_account_id = NEW.line_account_id
      AND c.form_id = NEW.form_id
      AND c.form_version_id = NEW.form_version_id
      AND c.friend_id = NEW.friend_id
      AND c.idempotency_key = NEW.idempotency_key
      AND c.request_hash = NEW.request_hash
      AND c.submission_id = NEW.submission_id
      AND c.booking_id = NEW.booking_id
      AND s.form_id = NEW.form_id
      AND s.form_version_id = NEW.form_version_id
      AND s.friend_id = NEW.friend_id
      AND b.line_account_id = NEW.line_account_id
      AND b.friend_id = NEW.friend_id
      AND fv.form_id = NEW.form_id
      AND la.tenant_id = NEW.tenant_id
  );
END;

-- claim所有整合＋UPDATE迂回防護。key/scope/所有のUPDATEは不可。
CREATE TRIGGER IF NOT EXISTS trg_form_booking_claims_immutable_scope
BEFORE UPDATE OF op_id, tenant_id, line_account_id, form_id, form_version_id,
  friend_id, idempotency_key, request_hash, lookup_key_hash,
  definition_snapshot_json, submission_id, booking_id ON form_booking_claims
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'claim scope immutable');
END;

-- link keyのUPDATE迂回防護。DELETE＋INSERT限定。
CREATE TRIGGER IF NOT EXISTS trg_form_booking_links_immutable_keys
BEFORE UPDATE OF claim_id, op_id, tenant_id, line_account_id, form_id,
  form_version_id, friend_id, submission_id, booking_id,
  idempotency_key, request_hash ON form_booking_links
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'link keys immutable: DELETE+INSERT only');
END;
