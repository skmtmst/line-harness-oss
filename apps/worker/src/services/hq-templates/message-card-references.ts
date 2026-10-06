import type { HqMessageCard, HqMessageReference } from '@line-crm/shared';
import { normalizeScopedTagName, type HqTemplateStatement } from '@line-crm/db';
import type { HqTemplateAuthority } from './contract.js';
import { HqTemplateError } from './tag.js';

type Row = Record<string, string | number | null>;
const guard = (condition: string, bindings: HqTemplateStatement['bindings']): HqTemplateStatement => ({ sql: `SELECT json(CASE WHEN (${condition}) THEN '{}' ELSE 'HQ_CARD_CONFLICT' END)`, bindings });
const exact = (table: 'forms' | 'scenarios', row: Row) => guard(`EXISTS(SELECT 1 FROM ${table} WHERE ${Object.keys(row).map(key => `${key} IS ?`).join(' AND ')})`, Object.values(row));
const ownersSql = `SELECT json_group_array(line_account_id) FROM (SELECT line_account_id FROM form_accounts WHERE form_id=? ORDER BY line_account_id)`;

export async function listMessageReferences(db: D1Database, authority: HqTemplateAuthority): Promise<HqMessageReference[]> {
  const scenarios = (await db.prepare(`SELECT s.id,s.name,a.name AS accountName FROM scenarios s JOIN line_accounts a ON a.id=s.line_account_id WHERE a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL ORDER BY s.name,s.id`).bind(authority.tenantId).all<Omit<HqMessageReference, 'kind'>>()).results;
  const forms = (await db.prepare(`SELECT f.id,f.name,group_concat(a.name, ' / ') AS accountName FROM forms f JOIN form_accounts fa ON fa.form_id=f.id JOIN line_accounts a ON a.id=fa.line_account_id WHERE f.status<>'archived' AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM form_accounts x LEFT JOIN line_accounts y ON y.id=x.line_account_id WHERE x.form_id=f.id AND (y.tenant_id IS NULL OR y.tenant_id<>? OR y.is_active<>1 OR y.archived_at IS NOT NULL)) GROUP BY f.id ORDER BY f.name,f.id`).bind(authority.tenantId, authority.tenantId).all<Omit<HqMessageReference, 'kind'>>()).results;
  return [...forms.map(row => ({ ...row, kind: 'form' as const })), ...scenarios.map(row => ({ ...row, kind: 'scenario' as const }))];
}

/** Only existing destination resources are reused. Every row and ownership list joins the preflight token and atomic guards. */
export async function messageCardReferences(db: D1Database, authority: HqTemplateAuthority, accountId: string, card?: HqMessageCard) {
  const targets: Record<string, string> = {}, snapshot: unknown[] = [], statements: HqTemplateStatement[] = [];
  const seen = new Set<string>();
  const unavailable = (): never => { throw new HqTemplateError('REFERENCE_UNAVAILABLE', 409); };
  for (const button of card?.buttons ?? []) {
    if (button.action !== 'form' && button.action !== 'scenario') continue;
    const key = `${button.action}:${button.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const table = button.action === 'form' ? 'forms' : 'scenarios';
    const source = button.action === 'form'
      ? await db.prepare(`SELECT f.* FROM forms f WHERE f.id=? AND f.status<>'archived' AND EXISTS(SELECT 1 FROM form_accounts fa JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM form_accounts fa LEFT JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND (a.tenant_id IS NULL OR a.tenant_id<>? OR a.is_active<>1 OR a.archived_at IS NOT NULL))`).bind(button.value, authority.tenantId, authority.tenantId).first<Row>()
      : await db.prepare(`SELECT s.* FROM scenarios s JOIN line_accounts a ON a.id=s.line_account_id WHERE s.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(button.value, authority.tenantId).first<Row>();
    if (!source) unavailable();
    const inventorySql = button.action === 'form'
      ? `SELECT f.* FROM forms f WHERE EXISTS(SELECT 1 FROM form_accounts fa WHERE fa.form_id=f.id AND fa.line_account_id=?) ORDER BY f.id`
      : `SELECT * FROM scenarios WHERE line_account_id=? ORDER BY id`;
    const inventory = (await db.prepare(inventorySql).bind(accountId).all<Row>()).results;
    const matches = inventory.filter(row => normalizeScopedTagName(String(row.name)) === normalizeScopedTagName(String(source!.name)));
    if (matches.length !== 1 || matches[0].status === 'archived') unavailable();
    const target = matches[0];
    snapshot.push([key, source, inventory]);
    statements.push(exact(table, source!), exact(table, target));
    // Guard the complete inventory as well, so a concurrent same-name addition cannot change the match.
    const inventoryJson = JSON.stringify(inventory);
    statements.push(guard(`(SELECT json_group_array(json(row)) FROM (SELECT json_object(${Object.keys(target).flatMap(column => [`'${column}'`, column]).join(',')}) AS row FROM ${table} WHERE ${button.action === 'form' ? 'EXISTS(SELECT 1 FROM form_accounts fa WHERE fa.form_id=forms.id AND fa.line_account_id=?)' : 'line_account_id=?'} ORDER BY id)) IS json(?)`, [accountId, inventoryJson]));
    if (button.action === 'form') {
      const readOwners = async (id: string) => (await db.prepare(`SELECT (${ownersSql}) AS owners`).bind(id).first<{ owners: string }>())!.owners;
      const sourceOwners = await readOwners(button.value), targetOwners = await readOwners(String(target.id));
      if (JSON.stringify(JSON.parse(targetOwners)) !== JSON.stringify([accountId])) unavailable();
      const account = await db.prepare(`SELECT liff_id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL`).bind(accountId, authority.tenantId).first<{ liff_id: string | null }>();
      const liffId = account?.liff_id;
      if (!liffId || !/^[A-Za-z0-9_-]{1,128}$/.test(liffId)) return unavailable();
      targets[key] = `https://liff.line.me/${liffId}?form=${encodeURIComponent(String(target.id))}`;
      snapshot.push([sourceOwners, targetOwners, liffId]);
      statements.push(guard(`(${ownersSql}) IS ?`, [button.value, sourceOwners]), guard(`(${ownersSql}) IS ?`, [target.id, targetOwners]), guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND liff_id IS ? AND is_active=1 AND archived_at IS NULL)`, [accountId, authority.tenantId, liffId]));
    } else {
      targets[key] = String(target.id);
      statements.push(guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [source!.line_account_id, authority.tenantId]));
    }
    if (button.action === 'form') statements.push(guard(`NOT EXISTS(SELECT 1 FROM form_accounts fa LEFT JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=? AND (a.tenant_id IS NULL OR a.tenant_id<>? OR a.is_active<>1 OR a.archived_at IS NOT NULL))`, [button.value, authority.tenantId]));
  }
  return { targets, snapshot, statements };
}
