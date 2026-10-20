import { normalizeScopedTagName } from '@line-crm/db';
import { validateRichMenuGroupForPublish } from '../../lib/rich-menu-publisher.js';
import type { HqRichMenuDefinition, LiffAction } from '@line-crm/shared';

import type { HqTemplateAuthority } from './contract.js';
import type { HqTemplateStatement } from '@line-crm/db';
import { HqTemplateError } from './tag.js';

type Area = HqRichMenuDefinition['richMenu']['pages'][number]['areas'][number];
/** Bind named booking pages to the receiving store, with an atomic inventory guard. */
export async function resolvePortableMenuActions(db:D1Database,auth:HqTemplateAuthority,accountId:string,areas:Area[]) {
  if(areas.some(a=>a.bookingMenuName||a.dataBindings)&&!await db.prepare('SELECT id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL').bind(accountId,auth.tenantId).first()) throw new HqTemplateError('FORBIDDEN',403);
  const actions=new Map<string,LiffAction>(),snapshot:unknown[]=[],statements:HqTemplateStatement[]=[],data:Record<string,Record<string,string>>={};
  for(const area of areas) for(const [field,name] of Object.entries(area.dataBindings ?? {})) {
    const query="SELECT id,value,version,updated_at FROM common_vars WHERE line_account_id=? AND name=? AND archived_at IS NULL AND status='active' AND (valid_from IS NULL OR julianday(valid_from)<=julianday('now')) AND (valid_until IS NULL OR julianday(valid_until)>julianday('now')) ORDER BY id";
    const rows=(await db.prepare(query).bind(accountId,name).all<{id:string;value:string;version:number;updated_at:string}>()).results;
    if(rows.length!==1||!rows[0].value)throw new HqTemplateError('REFERENCE_UNAVAILABLE',409);
    snapshot.push([accountId,name,rows]);
    statements.push({sql:`SELECT json(CASE WHEN (SELECT json_group_array(json_array(id,value,version,updated_at)) FROM (${query}))=json(?) THEN '{}' ELSE 'VERSION_CONFLICT' END)`,bindings:[accountId,name!,JSON.stringify(rows.map(r=>[r.id,r.value,r.version,r.updated_at]))]});
    (data[area.id]??={})[field]=field==='uri'&&area.intent==='tel'&&!rows[0].value.startsWith('tel:')?'tel:'+rows[0].value:rows[0].value;
  }
  for(const area of areas)if(data[area.id]) {
    if(area.intent==='tel'&&!/^tel:\+?[0-9() -]{3,30}$/.test(data[area.id].uri ?? area.actionData.uri))throw new HqTemplateError('INVALID_ACTION',422);
    try { validateRichMenuGroupForPublish({id:'binding',size:'large',chatBarText:'メニュー',isDefaultForAll:false,formBaseUrl:'https://liff.line.me/fixture',pages:[{id:'page',name:'page',orderIndex:0,imageR2Key:'binding',imageContentType:null,lineRichMenuId:null,areas:[{...area,actionData:{...area.actionData,...data[area.id]}}]}]}); } catch { throw new HqTemplateError('INVALID_ACTION',422); }
  }
  if (!areas.some(a=>a.bookingMenuName)) return {actions,snapshot,statements,data};
  const sql='SELECT id,name,version FROM menus WHERE line_account_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY id';
  const rows=(await db.prepare(sql).bind(accountId).all<{id:string;name:string;version:number}>()).results;
  snapshot.push([accountId,rows]);
  statements.push({sql:`SELECT json(CASE WHEN (SELECT json_group_array(json_array(id,name,version)) FROM (${sql}))=json(?) THEN '{}' ELSE 'VERSION_CONFLICT' END)`,bindings:[accountId,JSON.stringify(rows.map(r=>[r.id,r.name,r.version]))]});
  for (const area of areas) if(area.bookingMenuName) {
    const matches=rows.filter(r=>normalizeScopedTagName(r.name)===normalizeScopedTagName(area.bookingMenuName!));
    if(matches.length!==1) throw new HqTemplateError('REFERENCE_UNAVAILABLE',409);
    actions.set(`area:${area.id}`,{kind:'booking',menuId:matches[0].id});
  }
  return {actions,snapshot,statements,data};
}
