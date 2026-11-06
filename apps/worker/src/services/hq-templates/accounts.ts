import { HqTemplateError } from './tag.js';
import type { HqTemplateAuthority } from './contract.js';
export async function listTemplateAccounts(db: D1Database, authority: HqTemplateAuthority) {
  return (await db.prepare(`SELECT id,name,folder_id AS folderId FROM line_accounts WHERE tenant_id=? AND is_active=1 AND archived_at IS NULL ORDER BY name,id`).bind(authority.tenantId).all<{ id: string; name: string; folderId:string|null }>()).results;
}

export async function requireTargetAccounts(db: D1Database, authority: HqTemplateAuthority, ids: string[]) {
  if (!ids.length || ids.length > 30 || new Set(ids).size !== ids.length) throw new HqTemplateError('INVALID_ACCOUNTS');
  const allowed = await listTemplateAccounts(db, authority);
  if (ids.some(id => !allowed.some(a => a.id === id))) throw new HqTemplateError('FORBIDDEN', 403);
  return ids.map(id => allowed.find(a => a.id === id)!);
}
