-- #936 監査是正 N-263: 成果地点・成果イベントに統括(tenant)の所属を持たせる。
--
-- 直す前は地点の所属が line_account_id だけで、「全アカウント対象」
-- (line_account_id IS NULL)の地点は所属を持たず、記録経路(起点イベントの
-- 照合・URL到達・track API)が他の統括の友だちにも反応し得た。
-- アカウントの無い地点は既定の統括へ寄せる。未割当行を見られるのが
-- 既定の統括だけという既存の決めごと(canSeeUnassigned)と同じ帰結。
ALTER TABLE conversion_points ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE conversion_events ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

UPDATE conversion_points
SET tenant_id = COALESCE(
  (SELECT la.tenant_id FROM line_accounts la WHERE la.id = conversion_points.line_account_id),
  '00000000-0000-4000-8000-000000000001'
)
WHERE tenant_id IS NULL;

UPDATE conversion_events
SET tenant_id = COALESCE(
  (SELECT cp.tenant_id FROM conversion_points cp WHERE cp.id = conversion_events.conversion_point_id),
  '00000000-0000-4000-8000-000000000001'
)
WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversion_points_tenant
  ON conversion_points(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_tenant
  ON conversion_events(tenant_id);
