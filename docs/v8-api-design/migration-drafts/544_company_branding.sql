-- 候補544: 会社表示（company branding）V8-04
--
-- 将来の承認文（テンプレート。今回は承認要求しない）:
--   番号: 候補544（promotion直前に最新base＋公開PRと再確認）
--   列/表: tenants に display_name / login_display_name / logo_asset_id /
--     brand_slug / revision を追加し、新規表 tenant_logo_assets を作る。
--     既存 name/status/media 表は不変。
--   既存データ影響: 全行に既定値 backfill。既存 name を display_name へ
--     コピーしない（運用名と公開名は別物）。brand_slug は NULL のまま
--     （設定時に発行）。revision は 1。
--   対象環境: 開発・検証（本番は対象外）。
--   バックアップ/戻し方: 適用前に D1 エクスポートを取得。戻しは
--     544_company_branding_rollback.sql（論理rollback第一案。flag OFF＋
--     参照停止。列・表は残す。物理復元は別承認・保守時間・後続保全が条件）。
--   注意: tenants の版正本はこの revision のみ。547 は tenants に触らない。
--   539〜543未承認、538拒否済み。適用は承認後の別工程（今回は草稿のみ）。

ALTER TABLE tenants ADD COLUMN display_name TEXT;
ALTER TABLE tenants ADD COLUMN login_display_name TEXT;
ALTER TABLE tenants ADD COLUMN logo_asset_id TEXT REFERENCES tenant_logo_assets(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN brand_slug TEXT;
ALTER TABLE tenants ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(revision) = 'integer' AND revision >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_brand_slug
  ON tenants (brand_slug);

-- tenant所有のロゴ資産。既存 media 表は account 紐付き・tenant所有列なしの
-- ため、LINEなしtenant用に専用所有モデルを作る。実体は既存R2置き場を再利用
-- する（r2_key）。正方形・512px以上・1MB上限をCHECKする。
-- 保存mimeはPNGのみ（正本のPNG/SVG・1MBに合わせ、JPEG/WebPへ勝手に拡大
-- しない）。API受付はPNG/SVGのみ。SVGの扱いは設計選択待ち（元SVGを保存
-- せず安全PNG生成で保持する案が有力。04文書の案1/案2）。
CREATE TABLE IF NOT EXISTS tenant_logo_assets (
  id TEXT PRIMARY KEY CHECK (id IS NOT NULL),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'image/png'),
  width INTEGER NOT NULL CHECK (typeof(width) = 'integer' AND width >= 512),
  height INTEGER NOT NULL CHECK (typeof(height) = 'integer' AND height >= 512),
  bytes INTEGER NOT NULL CHECK (typeof(bytes) = 'integer' AND bytes > 0 AND bytes <= 1048576),
  scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending', 'clean', 'blocked', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  CHECK (width = height),
  UNIQUE (tenant_id, r2_key)
);

-- 他tenant資産の採用拒否。tenants の logo 参照は自tenant資産のみ。
-- 同等のserver同scope検査（asset.tenant_id = staff.tenantId）でも可。
CREATE TRIGGER IF NOT EXISTS trg_tenants_logo_same_tenant
BEFORE UPDATE OF logo_asset_id ON tenants
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'logo asset must be own tenant clean asset')
  WHERE NEW.logo_asset_id IS NOT NULL
    AND (
      (SELECT tenant_id FROM tenant_logo_assets WHERE id = NEW.logo_asset_id) != NEW.id
      OR (SELECT scan_status FROM tenant_logo_assets WHERE id = NEW.logo_asset_id) != 'clean'
    );
END;

-- INSERT時の他tenant資産採用も拒否する。
CREATE TRIGGER IF NOT EXISTS trg_tenants_logo_same_tenant_insert
BEFORE INSERT ON tenants
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'logo asset must be own tenant clean asset')
  WHERE NEW.logo_asset_id IS NOT NULL
    AND (
      (SELECT tenant_id FROM tenant_logo_assets WHERE id = NEW.logo_asset_id) != NEW.id
      OR (SELECT scan_status FROM tenant_logo_assets WHERE id = NEW.logo_asset_id) != 'clean'
    );
END;

-- 採用後の資産 tenant_id/r2_key 変更禁止（所有のすり替え防止）。
CREATE TRIGGER IF NOT EXISTS trg_logo_assets_immutable_keys
BEFORE UPDATE OF tenant_id, r2_key ON tenant_logo_assets
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'logo asset tenant/r2 immutable');
END;
