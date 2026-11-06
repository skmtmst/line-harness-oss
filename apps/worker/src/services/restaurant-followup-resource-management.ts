import { logger } from '@line-crm/shared/server';
import type { RestaurantFollowupManagement } from '@line-crm/shared';
import { hasDatabaseTable } from './schema-presence.js';
import { readFollowupEngineGate } from './restaurant-followup-engine-approval.js';

/** 非管理の一覧は索引付きの一括検索だけ。承認の照合は管理対象にだけ行う。 */
export async function readRestaurantFollowupResourceManagement(db:D1Database,engine:'reminder'|'automation',resources:ReadonlyArray<{id:string;lineAccountId:string|null}>){
 const result=new Map<string,RestaurantFollowupManagement>();
 if(!resources.length||!await hasDatabaseTable(db,'rt_store_followup_targets'))return result;
 const column=engine==='reminder'?'reminder_id':'automation_id',table=engine==='reminder'?'reminders':'automation_definitions';
 const supplied=new Set(resources.map(item=>JSON.stringify([item.id,item.lineAccountId])));
 const rows=(await db.prepare(`SELECT ft.${column} id,ft.engine,ft.enabled,ft.sending_status,s.id store_id,s.name store_name,s.line_account_id,d.current_published_version_id
  FROM rt_store_followup_targets ft JOIN rt_stores s ON s.id=ft.store_id JOIN ${table} d ON d.id=ft.${column} AND d.line_account_id=s.line_account_id
  WHERE ft.${column} IN(SELECT value FROM json_each(?))`).bind(JSON.stringify(resources.map(item=>item.id))).all<{
   id:string;engine:string;enabled:number;sending_status:string;store_id:string;store_name:string;line_account_id:string;current_published_version_id:string|null;
  }>()).results;
 await Promise.all(rows.map(async row=>{
  if(!supplied.has(JSON.stringify([row.id,row.line_account_id])))return;
  let active=false;
  try{const gate=await readFollowupEngineGate(db,{engine,targetId:row.id,lineAccountId:row.line_account_id,versionId:row.current_published_version_id??''});active=gate.managed&&gate.allowed;}
  catch{logger.warn('restaurant_followup_management_unavailable');}
  const reason=active?null:row.engine!==engine?'送り方を切り替えたため、来店フォローで止めています':row.enabled!==1?'来店フォローで止めています':row.sending_status==='active'?'内容や公開版が変わったため、止まっています。テスト送信と承認をやり直してください':'まだ送っていません。テスト送信と承認のあと送り始めます';
  result.set(row.id,{storeId:row.store_id,storeName:row.store_name,effectiveSendingStatus:active?'active':'stopped',reason,path:`/restaurant-test/line-followup?store_id=${encodeURIComponent(row.store_id)}`});
 }));
 return result;
}
