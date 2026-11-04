import { HqTemplateError } from './tag.js';
import type { HqTemplateAuthority } from './contract.js';
export async function listTemplateAccounts(db: D1Database, authority: HqTemplateAuthority) {
  return (await db.prepare(`SELECT a.id,a.name,a.folder_id AS folderId,COALESCE((SELECT s.style FROM account_styles s WHERE s.line_account_id=a.id),'standard') AS style FROM line_accounts a WHERE a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL ORDER BY a.name,a.id`).bind(authority.tenantId).all<{ id: string; name: string; folderId:string|null; style:string }>()).results;
}

export async function requireTargetAccounts(db: D1Database, authority: HqTemplateAuthority, ids: string[]) {
  if (!ids.length || ids.length > 30 || new Set(ids).size !== ids.length) throw new HqTemplateError('INVALID_ACCOUNTS');
  const allowed = await listTemplateAccounts(db, authority);
  if (ids.some(id => !allowed.some(a => a.id === id))) throw new HqTemplateError('FORBIDDEN', 403);
  return ids.map(id => allowed.find(a => a.id === id)!);
}
