import {GapError} from './gap-common.js';
import {assertChanged,clearAssertions} from '../features/booking/booking-series/index.js';
import {canAccessAllLineAccounts} from './account-access.js';
import {sha256Hex} from '../middleware/auth.js';
export async function requestMcpBroadcast(db:D1Database,input:{connectionId:string;account:string;actor:string;args:Record<string,unknown>;now:string}){
 const {connectionId,account,actor,args,now}=input;
 if(Object.keys(args).some(k=>!['accountId','broadcastId','expectedVersion','idempotencyKey','approverStaffId','testMode'].includes(k))||typeof args.broadcastId!=='string'||typeof args.idempotencyKey!=='string'||!/^[-\w:]{1,128}$/.test(args.idempotencyKey)||!Number.isSafeInteger(args.expectedVersion)||args.testMode!==true||typeof args.approverStaffId!=='string')throw new GapError('invalid_send_request');
 const owner=await db.prepare('SELECT tenant_id FROM staff_members WHERE id=? AND is_active=1').bind(actor).first<{tenant_id:string}>();
 const approver=await db.prepare("SELECT id,name,role FROM staff_members WHERE id=? AND tenant_id=? AND is_active=1 AND role IN('owner','admin') AND access_level='full'").bind(args.approverStaffId,owner?.tenant_id??'').first<{id:string;name:string;role:'owner'|'admin'}>();
 if(!approver||!await canAccessAllLineAccounts(db,{...approver,tenantId:owner?.tenant_id,readOnly:false},[account]))throw new GapError('invalid_approver',403);
 const key='mcp-send:'+await sha256Hex(JSON.stringify([connectionId,args.idempotencyKey])),request=await sha256Hex(JSON.stringify({broadcastId:args.broadcastId,version:args.expectedVersion,approver:args.approverStaffId}));
 const old=await db.prepare("SELECT target_id,refused_reason FROM mcp_call_logs WHERE id=? AND connection_id=? AND tool='request_broadcast_send' AND result='ok'").bind(key,connectionId).first<{target_id:string;refused_reason:string}>();
 if(old){if(old.target_id!==args.broadcastId||old.refused_reason!==request)throw new GapError('idempotency_conflict',409);return {broadcastId:old.target_id,approvalStatus:'pending',sent:false,testMode:true,replayed:true};}
 const ops=[db.prepare(`UPDATE broadcasts SET approval_status='pending',approval_requested_by_staff_id=?,approval_requested_at=?,approval_approver_staff_id=?,approval_note='AIからの模擬配信依頼',lock_version=lock_version+1
 WHERE id=? AND line_account_id=? AND status='draft' AND lock_version=? AND approval_status IN('none','rejected','cancelled','expired') AND EXISTS(SELECT 1 FROM broadcast_execution_contexts x WHERE x.broadcast_id=broadcasts.id AND x.mcp_connection_id=? AND x.state='draft' AND EXISTS(SELECT 1 FROM mcp_connections m JOIN staff_members s ON s.id=m.created_by WHERE m.id=x.mcp_connection_id AND m.status='active' AND m.level='send_request' AND julianday(m.expires_at)>julianday('now') AND s.is_active=1 AND s.role='owner' AND s.access_level='full'))`).bind(actor,now,approver.id,args.broadcastId,account,args.expectedVersion,connectionId),assertChanged(db),
 db.prepare("INSERT INTO broadcast_approval_events(id,broadcast_id,actor_staff_id,action,created_at) VALUES(?,?,?,'requested',?)").bind(crypto.randomUUID(),args.broadcastId,actor,now),
 db.prepare("INSERT INTO mcp_call_logs(id,connection_id,tool,account_id,kind,result,target_type,target_id,summary,refused_reason,at) VALUES(?,?,'request_broadcast_send',?,'send_request','ok','broadcast',?,'AIから模擬配信の承認を依頼した',?,?)").bind(key,connectionId,account,args.broadcastId,request,now),clearAssertions(db)];
 try{await db.batch(ops);}catch(e){const saved=await db.prepare('SELECT refused_reason FROM mcp_call_logs WHERE id=?').bind(key).first<{refused_reason:string}>();if(saved?.refused_reason===request)return {broadcastId:args.broadcastId,approvalStatus:'pending',sent:false,testMode:true,replayed:true};throw new GapError('version_conflict_or_forbidden',409);}
 return {broadcastId:args.broadcastId,version:Number(args.expectedVersion)+1,approvalStatus:'pending',sent:false,testMode:true,replayed:false};
}
