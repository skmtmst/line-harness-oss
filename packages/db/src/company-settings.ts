import type { CompanySettings, CompanySettingsInput } from '@line-crm/shared';

const COMPANY_COLUMNS = `t.name AS companyName,
  COALESCE(t.login_display_name,t.name) AS loginDisplayName,
  t.logo_media_id AS logoMediaId, t.logo_background_color AS logoBackgroundColor,
  t.company_settings_version AS version`;
const COMPANY_SELECT = `SELECT ${COMPANY_COLUMNS},
  CASE WHEN a.id IS NOT NULL AND m.archived_at IS NULL AND v.scan_status='verified'
    AND v.published_at IS NOT NULL THEN m.public_url ELSE NULL END AS logoUrl FROM tenants t
  LEFT JOIN media m ON m.id=t.logo_media_id
  LEFT JOIN line_accounts a ON a.id=m.line_account_id AND a.tenant_id=t.id
    AND a.is_active=1 AND a.archived_at IS NULL
  LEFT JOIN media_versions v ON v.media_id=m.id AND v.r2_key=m.r2_key
  WHERE t.id=?`;

/** 登録済み・公開済みの画像を、所属する会社の中でだけ選べる。 */
export async function isCompanyLogo(db: D1Database, tenantId: string, mediaId: string): Promise<boolean> {
  return !!await db.prepare(`SELECT m.id FROM media m
    JOIN line_accounts a ON a.id=m.line_account_id
    JOIN media_versions v ON v.media_id=m.id AND v.r2_key=m.r2_key
    WHERE m.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL
      AND m.archived_at IS NULL AND m.kind='image'
      AND m.mime_type IN ('image/png','image/jpeg','image/webp','image/gif')
      AND v.scan_status='verified' AND v.published_at IS NOT NULL`)
    .bind(mediaId, tenantId).first();
}

export async function getCompanySettings(db: D1Database, tenantId: string): Promise<CompanySettings | null> {
  return db.prepare(COMPANY_SELECT).bind(tenantId).first<CompanySettings>();
}

/** 保存と監査を一括実行する。更新に負けた場合は監査も増えない。 */
export async function saveCompanySettings(
  db: D1Database, tenantId: string, actorId: string, role: 'owner' | 'admin', input: CompanySettingsInput,
): Promise<CompanySettings | null> {
  const result = await db.batch([
    db.prepare(`UPDATE tenants SET name=?,login_display_name=?,logo_media_id=?,logo_background_color=?,
      company_settings_version=company_settings_version+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND company_settings_version=?
      AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND tenant_id=? AND is_active=1
        AND role IN ('owner','admin') AND access_level<>'read_only' AND account_scope<>'accounts')
      AND (? IS NULL OR EXISTS(SELECT 1 FROM media m JOIN line_accounts a ON a.id=m.line_account_id
        JOIN media_versions v ON v.media_id=m.id AND v.r2_key=m.r2_key
        WHERE m.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL
          AND m.archived_at IS NULL AND m.kind='image'
          AND m.mime_type IN ('image/png','image/jpeg','image/webp','image/gif')
          AND v.scan_status='verified' AND v.published_at IS NOT NULL))`)
      .bind(input.companyName, input.loginDisplayName, input.logoMediaId, input.logoBackgroundColor,
        tenantId, input.expectedVersion, actorId, tenantId, input.logoMediaId, input.logoMediaId, tenantId),
    db.prepare(`INSERT INTO audit_events(id,tenant_id,category,actor_principal_id,actor_role,action,
      target_kind,target_id,result,after_json)
      SELECT ?,?,'business',?,?,'company_settings.updated','tenant',?,'success',? WHERE changes()=1`)
      .bind(crypto.randomUUID(), tenantId, actorId, role, tenantId,
        JSON.stringify({ version: input.expectedVersion + 1 })),
    db.prepare(COMPANY_SELECT).bind(tenantId),
  ]);
  return result[0].meta.changes === 1 ? (result[2].results?.[0] as CompanySettings | undefined) ?? null : null;
}
