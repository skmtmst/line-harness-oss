import { DEFAULT_TENANT_ID } from '@line-crm/shared';
const STORE_SQL=`SELECT s.id FROM rt_stores s JOIN rt_organizations o ON o.id=s.organization_id JOIN line_accounts a ON a.id=s.line_account_id
 WHERE a.id=? AND a.is_active=1 AND a.archived_at IS NULL AND s.status='active' AND o.status!='archived'
 AND COALESCE(o.tenant_id,?)=COALESCE(a.tenant_id,?)`;
/** アカウントと組織が同じ統括の有効な店だけ。一意でなければ下書きに保つ。 */
export async function initialRestaurantStore(db:D1Database,account:string):Promise<string|null> {
 const stores=(await db.prepare(STORE_SQL+' ORDER BY s.id LIMIT 2').bind(account,DEFAULT_TENANT_ID,DEFAULT_TENANT_ID).all<{id:string}>()).results;
 return stores.length===1?stores[0]!.id:null;
}
/** 読んだ後に店の所属が変わった場合は、予約リンクもフォームも保存しない。 */
export function initialRestaurantStoreGuard(db:D1Database,account:string,store:string) {
 return db.prepare(`SELECT json(CASE WHEN (SELECT CASE WHEN COUNT(*)=1 THEN MIN(id) END FROM (${STORE_SQL}))=? THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`).bind(account,DEFAULT_TENANT_ID,DEFAULT_TENANT_ID,store);
}
