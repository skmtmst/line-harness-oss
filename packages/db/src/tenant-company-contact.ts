import type { TenantCompanyContact, TenantCompanyContactInfo } from '@line-crm/shared';

const COLUMNS = `legal_company_name AS legalCompanyName, company_postal_code AS postalCode,
  company_address AS address, company_building AS building, company_phone AS phone,
  contact_name AS contactName, contact_email AS contactEmail, invoice_addressee AS invoiceAddressee,
  company_settings_version AS revision`;
const SELECT = `SELECT ${COLUMNS} FROM tenants WHERE id=?`;

export function getTenantCompanyContact(db: D1Database, tenantId: string) {
  return db.prepare(SELECT).bind(tenantId).first<TenantCompanyContactInfo>();
}

function sameContact(a: TenantCompanyContact, b: TenantCompanyContact): boolean {
  return (Object.keys(b) as (keyof TenantCompanyContact)[]).every(key => a[key] === b[key]);
}

/** 期待した版だけを更新。返信が失われた同じ保存の再送は版も監査も増やさない。 */
export async function saveTenantCompanyContact(
  db: D1Database, tenantId: string, actorId: string, role: 'owner' | 'admin',
  input: TenantCompanyContact, expectedRevision: number,
): Promise<TenantCompanyContactInfo | null> {
  const current = await getTenantCompanyContact(db, tenantId);
  if (!current) return null;
  if (expectedRevision > current.revision) return null;
  if (sameContact(current, input)) return current;
  if (current.revision !== expectedRevision) return null;
  const results = await db.batch([
    db.prepare(`UPDATE tenants SET legal_company_name=?,company_postal_code=?,company_address=?,
      company_building=?,company_phone=?,contact_name=?,contact_email=?,invoice_addressee=?,
      company_settings_version=company_settings_version+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND company_settings_version=?`)
      .bind(input.legalCompanyName, input.postalCode, input.address, input.building, input.phone,
        input.contactName, input.contactEmail, input.invoiceAddressee, tenantId, expectedRevision),
    // 連絡先そのものは監査へ複製しない。
    db.prepare(`INSERT INTO audit_events(id,tenant_id,category,actor_principal_id,actor_role,action,
      target_kind,target_id,result,after_json)
      SELECT ?,?,'business',?,?,'tenant_company_contact.updated','tenant',?,'success',? WHERE changes()=1`)
      .bind(crypto.randomUUID(), tenantId, actorId, role, tenantId, JSON.stringify({ revision: expectedRevision + 1 })),
    db.prepare(SELECT).bind(tenantId),
  ]);
  const saved = results[2].results?.[0] as TenantCompanyContactInfo | undefined;
  return saved && (results[0].meta.changes === 1 || sameContact(saved, input)) ? saved : null;
}
