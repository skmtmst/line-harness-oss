-- オーナー承認 2026-10-09。テナントごとの既存の name,id 順を維持。

ALTER TABLE hq_template_folders ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (SELECT id,ROW_NUMBER() OVER(PARTITION BY tenant_id ORDER BY name,id)-1 AS n FROM hq_template_folders) UPDATE hq_template_folders SET display_order=(SELECT n FROM ranked WHERE ranked.id=hq_template_folders.id);

CREATE INDEX idx_hq_template_folders_order ON hq_template_folders(tenant_id,archived_at,display_order,name,id);

ALTER TABLE hq_broadcast_folders ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (SELECT id,ROW_NUMBER() OVER(PARTITION BY tenant_id ORDER BY name,id)-1 AS n FROM hq_broadcast_folders) UPDATE hq_broadcast_folders SET display_order=(SELECT n FROM ranked WHERE ranked.id=hq_broadcast_folders.id);

CREATE INDEX idx_hq_broadcast_folders_order ON hq_broadcast_folders(tenant_id,archived_at,display_order,name,id);
