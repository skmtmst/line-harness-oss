import { parseExecutionDateRange } from '@line-crm/shared';
import { StampError } from '../../services/visit-stamps.js';

interface SavedViewRow {
  id:string;tenant_id:string;staff_id:string;scope:'private'|'hq';name:string;conditions_json:string;revision:number;created_at:string;updated_at:string;
}
export interface HqBroadcastViewConditions {from?:string;to?:string;q?:string;status?:string;folderId?:string;sort?:'newest'|'oldest';limit?:number}
function conditions(value:unknown):HqBroadcastViewConditions {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new StampError('検索条件を確認してください',400,['conditions']);
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['from','to','q','status','folderId','sort','limit'].includes(k)))throw new StampError('保存できない検索条件があります',400,['conditions']);
  for(const key of ['from','to','q','status','folderId','sort'])if(v[key]!==undefined&&typeof v[key]!=='string')throw new StampError('検索条件を確認してください',400,['conditions']);
  try{parseExecutionDateRange({from:v.from as string|undefined,to:v.to as string|undefined});}catch{throw new StampError('期間を確認してください',400,['conditions']);}
  if(typeof v.q==='string'&&v.q.length>200)throw new StampError('検索は200文字以内にしてください',400,['conditions']);
  if(v.status!==undefined&&!['draft','pending_approval','scheduled','sending','sent','failed','stopped','cancelled'].includes(String(v.status)))throw new StampError('状態を確認してください',400,['conditions']);
  if(v.sort!==undefined&&!['newest','oldest'].includes(String(v.sort)))throw new StampError('並び順を確認してください',400,['conditions']);
  if(v.limit!==undefined&&(!Number.isSafeInteger(v.limit)||Number(v.limit)<1||Number(v.limit)>100))throw new StampError('表示件数を確認してください',400,['conditions']);
  if(typeof v.folderId==='string'&&(!v.folderId||v.folderId.length>200))throw new StampError('分類を確認してください',400,['conditions']);
  return v as HqBroadcastViewConditions;
}
function present(row:SavedViewRow,actorId:string,readOnly:boolean) {
  return {id:row.id,name:row.name,scope:row.scope,staffId:row.staff_id,conditions:JSON.parse(row.conditions_json) as HqBroadcastViewConditions,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,canEdit:row.staff_id===actorId&&!readOnly};
}
export async function listHqBroadcastViews(db:D1Database,tenantId:string,actorId:string,readOnly:boolean) {
  const rows=(await db.prepare(`SELECT * FROM hq_broadcast_saved_views WHERE tenant_id=? AND archived_at IS NULL AND (scope='hq' OR staff_id=?) ORDER BY updated_at DESC,id`)
    .bind(tenantId,actorId).all<SavedViewRow>()).results;
  return rows.map(row=>present(row,actorId,readOnly));
}
export async function saveHqBroadcastView(db:D1Database,tenantId:string,actorId:string,input:Record<string,unknown>,id?:string) {
  if(Object.keys(input).some(k=>!['name','scope','conditions','expectedRevision'].includes(k)))throw new StampError('入力を確認してください',400);
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>100||/[\u0000-\u001f\u007f]/u.test(input.name))throw new StampError('検索の名前を確認してください',400,['name']);
  let scope=input.scope===undefined?'hq':input.scope;if(scope!=='hq'&&scope!=='private')throw new StampError('共有範囲を確認してください',400,['scope']);
  const filter=conditions(input.conditions);
  if(filter.folderId&&filter.folderId!=='unfiled'&&!await db.prepare('SELECT id FROM hq_broadcast_folders WHERE id=? AND tenant_id=? AND archived_at IS NULL').bind(filter.folderId,tenantId).first())throw new StampError('分類が見つかりません',400,['conditions']);
  if(id){
    const row=await db.prepare('SELECT staff_id,scope FROM hq_broadcast_saved_views WHERE id=? AND tenant_id=? AND archived_at IS NULL').bind(id,tenantId).first<{staff_id:string;scope:'private'|'hq'}>();
    if(!row||row.staff_id!==actorId)throw new StampError('保存した検索が見つかりません',404);
    scope=input.scope===undefined?row.scope:input.scope;
    if(!Number.isSafeInteger(input.expectedRevision))throw new StampError('版を確認してください',400,['expectedRevision']);
  }
  const viewId=id??crypto.randomUUID(),now=new Date().toISOString();
  let result;
  try {
    result=id?await db.prepare(`UPDATE hq_broadcast_saved_views SET name=?,scope=?,conditions_json=?,revision=revision+1,updated_at=? WHERE id=? AND tenant_id=? AND staff_id=? AND revision=? AND archived_at IS NULL`)
      .bind(input.name.trim(),scope,JSON.stringify(filter),now,id,tenantId,actorId,input.expectedRevision).run()
      :await db.prepare('INSERT INTO hq_broadcast_saved_views(id,tenant_id,staff_id,name,scope,conditions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(viewId,tenantId,actorId,input.name.trim(),scope,JSON.stringify(filter),now,now).run();
  } catch(error) {
    if(String(error).includes('UNIQUE constraint failed'))throw new StampError('同じ名前の検索を保存済みです',409);
    throw error;
  }
  if(!result.meta.changes)throw new StampError('検索が更新されました。読み直してください',409);
  const row=await db.prepare('SELECT * FROM hq_broadcast_saved_views WHERE id=? AND tenant_id=? AND staff_id=?').bind(viewId,tenantId,actorId).first<SavedViewRow>();
  return present(row!,actorId,false);
}
export async function archiveHqBroadcastView(db:D1Database,tenantId:string,actorId:string,id:string,revision:unknown) {
  if(!Number.isSafeInteger(revision))throw new StampError('版を確認してください',400,['expectedRevision']);
  const row=await db.prepare('SELECT staff_id FROM hq_broadcast_saved_views WHERE id=? AND tenant_id=? AND archived_at IS NULL').bind(id,tenantId).first<{staff_id:string}>();
  if(!row||row.staff_id!==actorId)throw new StampError('保存した検索が見つかりません',404);
  const r=await db.prepare(`UPDATE hq_broadcast_saved_views SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=? AND tenant_id=? AND staff_id=? AND revision=? AND archived_at IS NULL`)
    .bind(new Date().toISOString(),new Date().toISOString(),id,tenantId,actorId,revision).run();
  if(!r.meta.changes)throw new StampError('検索が更新されました。読み直してください',409);
  return {id,archived:true};
}
