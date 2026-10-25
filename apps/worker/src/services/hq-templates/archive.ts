import { getHqTemplate } from '@line-crm/db';
import type { HqTemplateArchiveStatus } from '@line-crm/shared';
import type { HqTemplateAuthority } from './contract.js';
import { HqTemplateError } from './tag.js';

export function templateArchiveStatus(value: string | undefined): HqTemplateArchiveStatus {
  if (value === undefined) return 'active';
  if (value === 'active' || value === 'archived' || value === 'all') return value;
  throw new HqTemplateError('INVALID_STATUS');
}

/** 復元は統括の定義だけを戻し、店舗へ配布した独立の写しは変えない。 */
export async function restoreArchivedTemplate(db: D1Database, auth: HqTemplateAuthority, id: string, expectedRevision: unknown) {
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) throw new HqTemplateError('INVALID_REVISION');
  const current = await getHqTemplate(db, auth.tenantId, id);
  if (!current) throw new HqTemplateError('NOT_FOUND', 404);
  if (!current.archived_at || current.revision !== expectedRevision) throw new HqTemplateError('VERSION_CONFLICT', 409);
  try {
    await db.batch([
      db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_templates
        WHERE id=? AND tenant_id=? AND revision=? AND archived_at IS NOT NULL) THEN '{}' ELSE 'HQ_RESTORE_CONFLICT' END)`)
        .bind(id, auth.tenantId, expectedRevision),
      // 保管前の確認票やプレビュートークンを、復元で再び有効にしない。
      db.prepare("UPDATE hq_template_preflights SET status='expired' WHERE template_id=? AND tenant_id=? AND status='ready'").bind(id, auth.tenantId),
      db.prepare("UPDATE hq_form_test_tokens SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE template_id=? AND tenant_id=? AND revoked_at IS NULL").bind(id, auth.tenantId),
      db.prepare(`UPDATE hq_templates SET archived_at=NULL,revision=revision+1,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        folder_id=CASE WHEN EXISTS(SELECT 1 FROM hq_template_folders f WHERE f.id=hq_templates.folder_id
          AND f.tenant_id=hq_templates.tenant_id AND f.archived_at IS NULL) THEN folder_id ELSE NULL END
        WHERE id=? AND tenant_id=?`).bind(id, auth.tenantId),
      db.prepare(`INSERT INTO audit_events(id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result)
        VALUES (?,?,'business',?,?,'hq_template.restored','hq_template',?,'success')`)
        .bind(crypto.randomUUID(), auth.tenantId, auth.actorId, auth.role, id),
    ]);
  } catch (error) {
    if (/HQ_RESTORE_CONFLICT|malformed JSON/i.test(String(error))) throw new HqTemplateError('VERSION_CONFLICT', 409);
    throw error;
  }
  return { id, archived: false as const, revision: current.revision + 1 };
}
