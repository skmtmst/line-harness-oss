import type { HqTemplateStatement } from '@line-crm/db';
import type { HqTemplateTargetVersion } from '@line-crm/shared';

export async function targetDistributionVersion(
  db: D1Database, tenantId: string, templateId: string, accountId: string, latestVersion: number,
): Promise<HqTemplateTargetVersion> {
  const result = await db.prepare(`SELECT v.version FROM hq_template_distribution_results r
    JOIN hq_template_versions v ON v.id=r.template_version_id AND v.tenant_id=r.tenant_id AND v.template_id=r.template_id
    WHERE r.tenant_id=? AND r.template_id=? AND r.target_account_id=? AND r.status='succeeded'
    ORDER BY r.finished_at DESC,r.started_at DESC,r.rowid DESC LIMIT 1`)
    .bind(tenantId, templateId, accountId).first<{ version: number }>();
  const version = result?.version ?? null;
  const status = version === null ? 'undistributed' : version === latestVersion ? 'latest' : 'older';
  return { version, latestVersion, status,
    label: version === null ? '未配布' : `版${version}${status === 'latest' ? '（最新）' : ''}` };
}

/** 主項目の名前を、配布本体と同じ一括処理の中で記録する。後の改名で変わらない。 */
export function captureDistributionName(runId: string, tenantId: string, accountId: string): HqTemplateStatement {
  return {
    sql: `UPDATE hq_template_distribution_results SET created_name=(
      SELECT CASE r.item_kind
        WHEN 'tag' THEN (SELECT name FROM tags WHERE id=r.target_id AND line_account_id=r.target_account_id)
        WHEN 'scenario' THEN (SELECT name FROM scenarios WHERE id=r.target_id AND line_account_id=r.target_account_id)
        WHEN 'template' THEN CASE WHEN json_type(v.definition_json,'$.asset')='object'
          THEN (SELECT name FROM broadcast_message_assets WHERE id=r.target_id AND line_account_id=r.target_account_id)
          ELSE (SELECT name FROM templates WHERE id=r.target_id AND line_account_id=r.target_account_id) END
        WHEN 'rich_menu' THEN (SELECT name FROM rich_menu_groups WHERE id=r.target_id AND account_id=r.target_account_id)
        WHEN 'form' THEN (SELECT name FROM forms WHERE id=r.target_id
          AND EXISTS(SELECT 1 FROM form_accounts WHERE form_id=r.target_id AND line_account_id=r.target_account_id))
        END
      FROM hq_template_preflight_resolutions r
      JOIN hq_templates t ON t.id=r.template_id AND t.tenant_id=r.tenant_id
      JOIN hq_template_versions v ON v.id=r.template_version_id AND v.tenant_id=r.tenant_id
      WHERE r.preflight_id=hq_template_distribution_results.preflight_id
        AND r.tenant_id=hq_template_distribution_results.tenant_id
        AND r.target_account_id=hq_template_distribution_results.target_account_id
        AND r.item_kind=COALESCE(t.extended_type,t.template_type)
        AND (t.template_type<>'template' OR t.extended_type IS NOT NULL OR r.source_id='template:' || json_extract(v.definition_json,'$.template.id'))
      LIMIT 1)
      WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='succeeded' AND created_name IS NULL`,
    bindings: [runId, tenantId, accountId],
  };
}
