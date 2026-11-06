import { HqTemplateError } from './tag.js';
/** 名前を選ぶための読取り。本文・クーポンコード・友だち情報は返さない。 */
export async function searchHqResources(db:D1Database,tenantId:string,input:{kind?:string;q?:string;accountIds?:string;limit?:string;cursor?:string}) {
  const {kind,q=''}=input,ids=input.accountIds?.split(',')??[],limit=Number(input.limit??30),cursor=Number(input.cursor??0);
  if(!['tag','coupon','scenario'].includes(kind??'')||q.length>100||ids.length>30||new Set(ids).size!==ids.length||ids.some(id=>!id||id.length>100)||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(cursor)||cursor<0)throw new HqTemplateError('INVALID_REQUEST');
  const accounts=(await db.prepare('SELECT id,name FROM line_accounts WHERE tenant_id=? AND is_active=1 AND archived_at IS NULL ORDER BY name,id').bind(tenantId).all<{id:string;name:string}>()).results;
  if(ids.some(id=>!accounts.some(a=>a.id===id)))throw new HqTemplateError('FORBIDDEN',403);
  const selected=ids.length?accounts.filter(a=>ids.includes(a.id)):accounts;
  const table=kind==='tag'?'tags':kind==='scenario'?'scenarios':'broadcast_message_assets';
  const predicate=kind==='tag'?"r.status='active'":kind==='scenario'?"r.is_active=1":"r.kind='coupon' AND r.published_version>0";
  // 各店の同名候補は一つにまとめず、店名とIDを残す。
  const where=`a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL AND ${predicate} AND r.line_account_id IN (SELECT value FROM json_each(?)) AND instr(lower(r.name),lower(?))>0`;
  const bindings=[tenantId,JSON.stringify(selected.map(a=>a.id)),q.trim()];
  const total=(await db.prepare(`SELECT COUNT(*) n FROM ${table} r JOIN line_accounts a ON a.id=r.line_account_id WHERE ${where}`).bind(...bindings).first<{n:number}>())!.n;
  const items=(await db.prepare(`SELECT r.id,r.name,r.line_account_id AS accountId,a.name AS accountName FROM ${table} r JOIN line_accounts a ON a.id=r.line_account_id WHERE ${where} ORDER BY a.name,a.id,r.name,r.id LIMIT ? OFFSET ?`).bind(...bindings,limit,cursor).all<{id:string;name:string;accountId:string;accountName:string}>()).results;
  return {kind,items,total,nextCursor:cursor+limit<total?String(cursor+limit):null};
}
