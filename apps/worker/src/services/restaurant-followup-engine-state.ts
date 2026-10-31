import type { RestaurantFollowupTrigger } from '@line-crm/shared';
import { getReminderDraftVersion,getReminderPublishedVersion } from '@line-crm/db';
import { automationRevisionToken } from '../features/automations/automation-drafts/index.js';
import { readFollowupEngineGate } from './restaurant-followup-engine-approval.js';

/** 対応表のactiveをそのまま送信中とは表示しない。実物・承認の現在の一致を見る。 */
export async function readRestaurantFollowupEngineStates(db:D1Database,storeId:string){
 const targets=(await db.prepare(`SELECT ft.*,s.line_account_id FROM rt_store_followup_targets ft JOIN rt_stores s ON s.id=ft.store_id WHERE ft.store_id=? ORDER BY trigger`)
  .bind(storeId).all<{trigger:RestaurantFollowupTrigger;engine:'scenario'|'reminder'|'automation';reminder_id:string|null;automation_id:string|null;enabled:number;sending_status:string;approved_version_id:string|null;version:number;line_account_id:string}>()).results;
 return Promise.all(targets.map(async target=>{
  const id=target.engine==='reminder'?target.reminder_id:target.automation_id;
  let contentRevision:string|null=null;
  if(target.engine==='reminder'&&id){const version=await getReminderDraftVersion(db,id)??await getReminderPublishedVersion(db,id);contentRevision=version?`${version.id}:${version.updated_at}`:null;}
  if(target.engine==='automation'&&id){const version=await db.prepare(`SELECT v.* FROM automation_definitions d JOIN automation_versions v ON v.id=COALESCE(d.current_draft_version_id,d.current_published_version_id) WHERE d.id=? AND d.line_account_id=?`).bind(id,target.line_account_id).first<{id:string;trigger_type:string;trigger_config:string;condition_config:string;action_config:string}>();if(version)contentRevision=await automationRevisionToken(version.id,version);}
  const gate=id&&target.engine!=='scenario'?await readFollowupEngineGate(db,{engine:target.engine,targetId:id,lineAccountId:target.line_account_id,versionId:target.approved_version_id??''}):null;
  const active=!!gate?.managed&&gate.allowed;
  return {trigger:target.trigger,engine:target.engine,targetId:id,targetVersion:target.version,contentRevision,enabled:target.enabled===1,
   effectiveSendingStatus:active?'active' as const:'stopped' as const,
   reason:active?null:target.enabled!==1?'来店フォローで止めています':target.sending_status==='active'?'内容や公開版が変わったため、止まっています。テスト送信と承認をやり直してください':'まだ送っていません。テスト送信と承認のあと送り始めます',
   detailPath:id?target.engine==='reminder'?`/reminders/detail?id=${encodeURIComponent(id)}`:`/automations/drafts?id=${encodeURIComponent(id)}`:null};
 }));
}
