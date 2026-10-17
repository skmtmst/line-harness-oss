import { normalizeScopedTagName } from '@line-crm/db';
import { requireTargetAccounts, HqTemplateError } from './distribution.js';
import { parseRichMenuTemplateDefinition, richMenuReferences } from './rich-menu.js';
import type { HqTemplateAuthority } from './contract.js';

type Reference = { kind: string; sourceId: string; name?: string };
type Resource = { id: string; name: string; available: number };
/** This is a read-only draft check. The persisted preflight remains mandatory before distribution. */
export async function previewRichMenu(db: D1Database, authority: HqTemplateAuthority, input: Record<string, unknown>, bucket: Pick<R2Bucket, 'head'>) {
  if (!Array.isArray(input.accountIds) || input.accountIds.some(id => typeof id !== 'string')) throw new HqTemplateError('INVALID_ACCOUNTS');
  const accounts = await requireTargetAccounts(db, authority, input.accountIds as string[]);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new HqTemplateError('INVALID_NAME');
  let definition;
  if (input.definition !== undefined) {
    try { definition = parseRichMenuTemplateDefinition({templateVersionId:'preview',definitionJson:JSON.stringify(input.definition)}, authority.tenantId); }
    catch { throw new HqTemplateError('INVALID_DEFINITION'); }
  }
  const name = input.name.trim();
  if (definition && definition.richMenu.name !== name) throw new HqTemplateError('INVALID_NAME');
  const refs: Reference[] = definition ? richMenuReferences(definition) : [];
  if (definition) for (const p of definition.richMenu.pages) for (const a of p.areas) {
    for(const name of Object.values(a.dataBindings ?? {})) refs.push({kind:'common_var',sourceId:`name:${name}`,name});
    if (a.intent === 'booking' && a.bookingMenuName) refs.push({kind:'booking',sourceId:`name:${a.bookingMenuName}`,name:a.bookingMenuName});
    if (a.intent === 'booking' && a.actionData.menuId) refs.push({kind:'booking',sourceId:a.actionData.menuId});
    if (a.intent === 'visit_stamp' && a.actionData.cardId) refs.push({kind:'visit_stamp',sourceId:a.actionData.cardId});
  }
  if (definition?.richMenu.displayAudience === 'tag') refs.push({kind:'audience_tag',sourceId:'audience',name:definition.richMenu.displayTagName});
  if (definition?.richMenu.pages.some(p=>p.areas.some(a=>['form','booking','booking_history','visit_stamp'].includes(a.intent??'')))) refs.push({kind:'liff',sourceId:'account-liff',name:'LIFF'});
  const resources = new Map<string, Resource[]>();
  const load = async (kind: string, accountId: string): Promise<Resource[]> => {
    const key = `${kind}:${accountId}`;
    if (resources.has(key)) return resources.get(key)!;
    let sql: string, bindings: string[];
    if (kind === 'liff') {
      sql="SELECT id,'LIFF' name,CASE WHEN liff_id IS NOT NULL AND trim(liff_id)<>'' THEN 1 ELSE 0 END available FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL";bindings=[accountId,authority.tenantId];
    } else if (kind === 'form') {
      sql = `SELECT f.id,f.name,CASE WHEN f.status<>'archived' AND (?='' OR NOT EXISTS(SELECT 1 FROM form_accounts x WHERE x.form_id=f.id AND x.line_account_id<>?)) THEN 1 ELSE 0 END available
        FROM forms f WHERE EXISTS(SELECT 1 FROM form_accounts fa JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL ${accountId ? 'AND a.id=?' : ''})
        AND NOT EXISTS(SELECT 1 FROM form_accounts fa LEFT JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND (a.tenant_id IS NULL OR a.tenant_id<>?))`;
      bindings = [accountId,accountId,authority.tenantId,...(accountId ? [accountId] : []),authority.tenantId];
    } else if (kind === 'visit_stamp') {
      sql = `SELECT c.id,c.name,1 available FROM visit_stamp_cards c WHERE c.tenant_id=? AND c.active=1 ${accountId ? 'AND EXISTS(SELECT 1 FROM visit_stamp_card_accounts ca WHERE ca.card_id=c.id AND ca.line_account_id=?)' : ''}`;
      bindings = [authority.tenantId,...(accountId ? [accountId] : [])];
    } else {
      const table = {tag:'tags',audience_tag:'tags',template:'templates',scenario:'scenarios',booking:'menus',common_var:'common_vars'}[kind];
      if (!table) throw new HqTemplateError('INVALID_REFERENCE');
      const available = kind === 'tag' || kind === 'audience_tag' ? "r.status='active'" : kind === 'booking' ? 'r.is_active=1 AND r.deleted_at IS NULL' : kind==='common_var' ? "r.archived_at IS NULL AND r.status='active' AND (r.valid_from IS NULL OR julianday(r.valid_from)<=julianday('now')) AND (r.valid_until IS NULL OR julianday(r.valid_until)>julianday('now'))" : '1';
      sql = `SELECT r.id,r.name,CASE WHEN ${available} THEN 1 ELSE 0 END available FROM ${table} r JOIN line_accounts a ON a.id=r.line_account_id WHERE a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL ${accountId ? 'AND a.id=?' : ''}`;
      bindings = [authority.tenantId,...(accountId ? [accountId] : [])];
    }
    const rows = (await db.prepare(sql).bind(...bindings).all<Resource>()).results;
    resources.set(key,rows); return rows;
  };
  const references = [];
  for (const ref of new Map(refs.map(ref => [`${ref.kind}:${ref.sourceId}`,ref])).values()) {
    const source = ref.name ? {name:ref.name} : (await load(ref.kind,'')).find(row => row.id === ref.sourceId && row.available === 1);
    // A shared form can still be a source; its target must belong only to the receiving account.
    const sourceName = source?.name ?? null;
    const matches = [];
    for (const account of accounts) {
      const rows = sourceName ? (await load(ref.kind,account.id)).filter(row => normalizeScopedTagName(row.name) === normalizeScopedTagName(sourceName)) : [];
      const available = rows.length === 1 && rows[0].available === 1;
      matches.push({accountId:account.id,accountName:account.name,status:!sourceName?'source_unavailable':rows.length>1?'ambiguous':available?'available':'missing',targetId:available?rows[0].id:null});
    }
    references.push({...ref,name:sourceName,availableAccountCount:matches.filter(row => row.status === 'available').length,totalAccountCount:accounts.length,accounts:matches});
  }
  const stores = [];
  for (const account of accounts) {
    const menus = (await db.prepare(`SELECT g.id,g.name,g.status,CASE WHEN g.status='draft' AND g.publishing_owner IS NULL AND g.publishing_at IS NULL AND g.publishing_expires_at IS NULL AND NOT EXISTS(SELECT 1 FROM rich_menu_pages p WHERE p.group_id=g.id AND p.line_richmenu_id IS NOT NULL) THEN 1 ELSE 0 END can_overwrite FROM rich_menu_groups g WHERE g.account_id=? AND g.name=? ORDER BY g.id`).bind(account.id,name).all<{id:string;name:string;status:string;can_overwrite:number}>()).results;
    stores.push({accountId:account.id,accountName:account.name,sameNameMenus:menus,canOverwrite:menus.length === 1 && menus[0].can_overwrite === 1,missingReferences:references.filter(ref => ref.accounts.find(row => row.accountId === account.id)?.status !== 'available').map(ref => ({kind:ref.kind,sourceId:ref.sourceId,name:ref.name}))});
  }
  const images = [];
  for (const p of definition?.richMenu.pages ?? []) {
    const object = await bucket.head(p.imageR2Key);
    const valid = !!object && object.size > 0 && object.size <= 1024*1024 && ['image/png','image/jpeg'].includes(object.httpMetadata?.contentType ?? '');
    images.push({pageId:p.id,sizeBytes:valid?object!.size:null,sizeKb:valid?object!.size/1024:null,available:valid});
  }
  return {name,stores,references,images,summary:{accountCount:accounts.length,sameNameAccountCount:stores.filter(s=>s.sameNameMenus.length>0).length,overwriteCount:stores.filter(s=>s.canOverwrite).length,createCount:stores.filter(s=>!s.canOverwrite).length,missingReferences:stores.reduce((n,s)=>n+s.missingReferences.length,0),missingTags:stores.reduce((n,s)=>n+s.missingReferences.filter(r=>r.kind==='tag'||r.kind==='audience_tag').length,0)},requiresPreflight:true};
}
