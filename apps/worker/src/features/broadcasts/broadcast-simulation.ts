import { audience, permitted } from './simulation-preview.js';
export { simulationContext, simulationPreview } from './simulation-preview.js';
import { simulationContext, simulationPreview } from './simulation-preview.js';
export type { BroadcastPurpose } from './simulation-preview.js';
import type { BroadcastPurpose } from './simulation-preview.js';
import {getBroadcastById} from '@line-crm/db';
import {BROADCAST_DEFINITION_PUBLISH_KEY} from '@line-crm/shared';
import {GapError} from '../../services/gap-common.js';
import {sha256Hex} from '../../middleware/auth.js';
import {assertChanged,clearAssertions} from '../booking/booking-series/index.js';
import {broadcastQuietHoursShift} from '../../services/gap-send-preview.js';
import {canAccessAllLineAccounts} from '../../services/account-access.js';
import {findUnsupportedInterpolations} from '@line-crm/shared';
export const purposeAliases={transaction:['transaction','transactional','reservation'],notice:['notice','notification'],marketing:['marketing','promotion','advertising','宣伝']};
export function simulationDraftInput(b:Record<string,unknown>){
 if(b.testMode!==true)throw new GapError('test_mode_required',409);
 if(!Object.hasOwn(purposeAliases,String(b.purpose))||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||typeof b.text!=='string'||!b.text.trim()||b.text.length>5000||findUnsupportedInterpolations(b.text).length||b.targetTagId!==undefined&&b.targetTagId!==null&&typeof b.targetTagId!=='string')throw new GapError('invalid_simulation_draft');
 return {title:b.title.trim(),text:b.text,purpose:b.purpose as BroadcastPurpose,targetTagId:typeof b.targetTagId==='string'?b.targetTagId:null};
}
export async function saveSimulationDraft(db:D1Database,a:string,actor:string,key:string,b:Record<string,unknown>,id?:string){
 const content=simulationDraftInput(b),request=JSON.stringify(content),fingerprint=await sha256Hex(request);
 if(content.targetTagId&&!await db.prepare('SELECT id FROM tags WHERE id=? AND line_account_id=? AND archived_at IS NULL').bind(content.targetTagId,a).first())throw new GapError('invalid_tag');
 if(!id){
 const prior=await db.prepare('SELECT broadcast_id,request_fingerprint FROM broadcast_execution_contexts WHERE account_id=? AND created_by=? AND request_key=?').bind(a,actor,key).first<{broadcast_id:string;request_fingerprint:string}>();
 if(prior){if(prior.request_fingerprint!==fingerprint)throw new GapError('idempotency_conflict',409);return {id:prior.broadcast_id,replayed:true};}
 id='sim-'+await sha256Hex(JSON.stringify([a,actor,key]));
 try{await db.batch([db.prepare("INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status) VALUES(?,?,'text',?,?,?,?,'draft')").bind(id,content.title,content.text,content.targetTagId?'tag':'all',content.targetTagId,a),db.prepare("INSERT INTO broadcast_execution_contexts(broadcast_id,account_id,purpose,created_via,created_by,request_key,request_fingerprint) VALUES(?,?,?,'manual',?,?,?)").bind(id,a,content.purpose,actor,key,fingerprint)]);}catch(e){const saved=await simulationContext(db,id);if(saved?.request_fingerprint===fingerprint)return {id,replayed:true};throw e;}
 return {id,replayed:false};
 }
 await db.batch([db.prepare("INSERT INTO broadcast_approval_events(id,broadcast_id,actor_staff_id,action,reason,created_at) SELECT ?,id,?,'cancelled','内容の変更',? FROM broadcasts WHERE id=? AND line_account_id=? AND lock_version=? AND approval_status IN('pending','approved')").bind(crypto.randomUUID(),actor,new Date().toISOString(),id,a,b.expectedVersion),db.prepare("UPDATE broadcasts SET title=?,message_content=?,target_type=?,target_tag_id=?,lock_version=lock_version+1,approval_status='none' WHERE id=? AND line_account_id=? AND status='draft' AND lock_version=? AND EXISTS(SELECT 1 FROM broadcast_execution_contexts x WHERE x.broadcast_id=broadcasts.id AND x.state='draft')").bind(content.title,content.text,content.targetTagId?'tag':'all',content.targetTagId,id,a,b.expectedVersion),assertChanged(db),db.prepare('UPDATE broadcast_execution_contexts SET purpose=? WHERE broadcast_id=?').bind(content.purpose,id),clearAssertions(db)]);
 return {id,replayed:false};
}
export async function scheduleSimulation(db:D1Database,id:string,b:Record<string,unknown>,key:string,now=new Date()){
 if(b.testMode!==true)throw new GapError('test_mode_required',409);
 if(!/^[-\w:]{1,128}$/.test(key))throw new GapError('idempotency_key_required');
 const x=await simulationContext(db,id);if(!x)throw new GapError('not_found',404);
 const request=JSON.stringify({expectedVersion:b.expectedVersion,confirmedRecipientCount:b.confirmedRecipientCount,scheduledAt:b.scheduledAt??null});
 if(x.execution_key===key){if(x.execution_request_json!==request)throw new GapError('idempotency_conflict',409);return {scheduled:x.state==='scheduled',completed:x.state==='completed',replayed:true,testMode:true,sent:false};}
 const preview=await simulationPreview(db,id);if(preview.version!==b.expectedVersion||preview.recipients!==b.confirmedRecipientCount||preview.recipients===0)throw new GapError('SEND_PREVIEW_CHANGED',409);
 const {enforceBroadcastSendApproval}=await import('./broadcast-approval.js');const gate=await enforceBroadcastSendApproval(db,(await getBroadcastById(db,id))!,{confirmedRecipientCount:b.confirmedRecipientCount});if(!gate.allowed)throw new GapError(gate.code,409);
 if(x.created_via==='mcp'){
 const approval=await db.prepare("SELECT id FROM broadcasts WHERE id=? AND approval_status='approved' AND approval_decided_by_staff_id IS NOT NULL").bind(id).first();if(!approval)throw new GapError('APPROVAL_REQUIRED',409);
 }
 if(b.scheduledAt!==undefined&&(typeof b.scheduledAt!=='string'||!Number.isFinite(Date.parse(b.scheduledAt))||Date.parse(b.scheduledAt)<now.getTime()))throw new GapError('invalid_schedule');
 const at=typeof b.scheduledAt==='string'?b.scheduledAt:now.toISOString(),shift=await broadcastQuietHoursShift(db,String(x.account_id),at),scheduled=shift??at;
 try{await db.batch([
 db.prepare("UPDATE broadcasts SET status='scheduled',scheduled_at=?,lock_version=lock_version+1,total_count=?,success_count=0 WHERE id=? AND lock_version=? AND status='draft' AND stopped_at IS NULL").bind(scheduled,preview.recipients,id,b.expectedVersion),assertChanged(db),
 db.prepare("UPDATE broadcast_execution_contexts SET state='scheduled',execution_key=?,execution_request_json=?,confirmed_count=? WHERE broadcast_id=? AND state='draft'").bind(key,request,preview.recipients,id),assertChanged(db),
 db.prepare(`INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,state,error_code) SELECT b.id,f.id,f.line_account_id,'claimed','simulation_pending' FROM broadcasts b JOIN broadcast_execution_contexts x ON x.broadcast_id=b.id JOIN friends f ON ${audience} WHERE b.id=? AND ${permitted}`).bind(id),clearAssertions(db)]);}catch(e){const saved=await simulationContext(db,id);if(saved?.execution_key===key&&saved.execution_request_json===request)return {scheduled:true,replayed:true,testMode:true,sent:false};if(/CHECK constraint/.test(String(e)))throw new GapError('version_conflict',409);throw e;}
 return {scheduled:true,scheduledAt:scheduled,quietHoursShiftTo:shift,testMode:true,sent:false,replayed:false};
}
/** Called by the existing immediate, scheduled and queued entry points before any transport. */
export async function processBroadcastSimulation(db:D1Database,id:string,now=new Date()){
 const x=await simulationContext(db,id);if(!x)return false;
 if(x.state!=='scheduled')return true;
 const a=String(x.account_id);
 const actor=await db.prepare("SELECT s.id,s.name,s.role,s.tenant_id,s.permission_keys FROM staff_members s JOIN line_accounts a ON a.tenant_id=s.tenant_id WHERE s.id=? AND a.id=? AND s.is_active=1 AND s.access_level='full'").bind(x.created_by,a).first<{id:string;name:string;role:'owner'|'admin'|'staff';tenant_id:string;permission_keys:string}>();
 if(!actor||!(['owner','admin'].includes(actor.role)||JSON.parse(actor.permission_keys).includes(BROADCAST_DEFINITION_PUBLISH_KEY))||!await canAccessAllLineAccounts(db,{...actor,tenantId:actor.tenant_id,readOnly:false},[a]))return true;
 if(!await db.prepare("SELECT a.id FROM line_accounts a JOIN tenants t ON t.id=a.tenant_id WHERE a.id=? AND a.is_active=1 AND a.archived_at IS NULL AND t.status='active'").bind(a).first())return true;
 if(x.created_via==='mcp'){
 const connection=await db.prepare("SELECT m.created_by,m.organization_id FROM mcp_connections m JOIN staff_members s ON s.id=m.created_by AND s.tenant_id=m.organization_id WHERE m.id=? AND m.status='active' AND m.level='send_request' AND julianday(m.expires_at)>julianday(?) AND s.is_active=1 AND s.role='owner' AND s.access_level='full'").bind(x.mcp_connection_id,now.toISOString()).first<{created_by:string;organization_id:string}>();
 if(!connection||!await canAccessAllLineAccounts(db,{id:connection.created_by,tenantId:connection.organization_id,role:'owner',name:'',readOnly:false},[a]))return true;
 }
 const connectionGuard=x.created_via==='mcp'?"AND EXISTS(SELECT 1 FROM mcp_connections m JOIN staff_members s ON s.id=m.created_by WHERE m.id=x.mcp_connection_id AND m.status='active' AND m.level='send_request' AND julianday(m.expires_at)>julianday('now') AND s.is_active=1 AND s.access_level='full' AND s.role='owner')":'';
 const canRun=`EXISTS(SELECT 1 FROM broadcasts b JOIN broadcast_execution_contexts x ON x.broadcast_id=b.id WHERE b.id=? AND b.status='scheduled' AND b.stopped_at IS NULL AND x.state='scheduled' AND EXISTS(SELECT 1 FROM staff_members s WHERE s.id=x.created_by AND s.is_active=1 AND s.access_level='full') ${connectionGuard} AND julianday(b.scheduled_at)<=julianday(?) AND (x.created_via!='mcp' OR b.approval_status='approved' AND b.approval_decided_by_staff_id IS NOT NULL AND EXISTS(SELECT 1 FROM staff_members approver WHERE approver.id=b.approval_decided_by_staff_id AND approver.is_active=1 AND approver.access_level='full' AND approver.role IN('owner','admin'))))`;
 await db.batch([
 db.prepare(`UPDATE broadcast_send_claims AS c SET state='failed',error_code=CASE WHEN EXISTS(SELECT 1 FROM friends f JOIN broadcasts b ON b.id=c.broadcast_id JOIN broadcast_execution_contexts x ON x.broadcast_id=b.id WHERE f.id=c.friend_id AND ${audience} AND ${permitted}) THEN 'simulation_only' ELSE 'simulation_suppressed' END,settled_at=? WHERE c.broadcast_id=? AND c.state='claimed' AND c.error_code='simulation_pending' AND ${canRun}`).bind(now.toISOString(),id,id,now.toISOString()),
 db.prepare(`UPDATE broadcast_execution_contexts SET state='completed',completed_at=? WHERE broadcast_id=? AND ${canRun}`).bind(now.toISOString(),id,id,now.toISOString()),
 db.prepare("UPDATE broadcasts SET status='sent',sent_at=?,success_count=0,batch_lock_at=NULL WHERE id=? AND EXISTS(SELECT 1 FROM broadcast_execution_contexts x WHERE x.broadcast_id=broadcasts.id AND x.state='completed') AND status='scheduled'").bind(now.toISOString(),id)]);
 return true;
}
