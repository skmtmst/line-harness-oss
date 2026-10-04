-- 候補545: 保存検索の役割共有＋履歴snapshot列（V8-05）
--
-- 将来の承認文（テンプレート。今回は承認要求しない）:
--   番号: 候補545（promotion直前に最新base＋公開PRと再確認）
--   列/表: 新規表 saved_search_share_roles＋既存 saved_search_revisions へ
--     share_acl_json を追加。saved_searches.is_shared 列は残す
--     （互換維持。移行であって置換ではない）。
--   既存データ影響: 既存行の変更なし。新規表は空で始まる。flag OFF・
--     旧clientでは is_shared=0（private）扱いのため共有範囲は拡大しない。
--   対象環境: 開発・検証（本番は対象外）。
--   バックアップ/戻し方: 適用前に D1 エクスポートを取得。戻しは
--     545_saved_search_roles_rollback.sql（論理rollbackのみ。表は残し
--     DROPしない。物理復元は別承認・保守時間・後続保全が条件）。
--   539〜543未承認、538拒否済み。適用は承認後の別工程（今回は草稿のみ）。

CREATE TABLE IF NOT EXISTS saved_search_share_roles (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  role_kind TEXT NOT NULL
    CHECK (role_kind IN ('technicalRole', 'roleBundle')),
  role TEXT NOT NULL
    CHECK ((role_kind = 'technicalRole' AND role IN ('owner', 'admin', 'staff'))
        OR (role_kind = 'roleBundle' AND role IN ('administrator', 'operations', 'reception', 'view_only', 'custom'))),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (search_id, role_kind, role)
);

CREATE INDEX IF NOT EXISTS idx_saved_search_share_roles_search
  ON saved_search_share_roles (search_id);

-- 履歴snapshot列。過去行のNULLは legacy is_shared から解釈する
-- （0→private、1→all_allowed）。snapshot {mode,roleKind,roles} は
-- 成功した親revisionにguard付きINSERTで保存する。
ALTER TABLE saved_search_revisions ADD COLUMN share_acl_json TEXT
  CHECK (share_acl_json IS NULL OR json_valid(share_acl_json));

-- 同一検索のcatalog混在禁止。roleKindは検索ごとに1種類。
CREATE TRIGGER IF NOT EXISTS trg_share_roles_single_catalog
BEFORE INSERT ON saved_search_share_roles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'mixed role catalog in one search')
  WHERE EXISTS (
    SELECT 1 FROM saved_search_share_roles
    WHERE search_id = NEW.search_id AND role_kind != NEW.role_kind
  );
END;

-- roles挿入時は親 is_shared=0 を要求する（legacy共有との二重公開防止）。
CREATE TRIGGER IF NOT EXISTS trg_share_roles_require_private_parent
BEFORE INSERT ON saved_search_share_roles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'roles require parent is_shared=0')
  WHERE (SELECT is_shared FROM saved_searches WHERE id = NEW.search_id) != 0;
END;

-- roles存在中の legacy PATCH is_shared=1 を拒否する（公開拡大防止）。
-- 同等のserver gate（共有設定変更前のroles存在確認）でも可。
CREATE TRIGGER IF NOT EXISTS trg_saved_search_no_expand_with_roles
BEFORE UPDATE OF is_shared ON saved_searches
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'is_shared=1 blocked while roles exist')
  WHERE NEW.is_shared = 1
    AND EXISTS (SELECT 1 FROM saved_search_share_roles WHERE search_id = NEW.id);
END;

-- 子UPDATEによる search_id/role_kind 移動の迂回禁止。key/catalogの
-- UPDATEは不可とし、DELETE＋INSERT限定にする。
CREATE TRIGGER IF NOT EXISTS trg_share_roles_immutable_keys
BEFORE UPDATE OF search_id, role_kind ON saved_search_share_roles
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'search_id/role_kind immutable: DELETE+INSERT only')
  WHERE OLD.search_id != NEW.search_id OR OLD.role_kind != NEW.role_kind;
END;
