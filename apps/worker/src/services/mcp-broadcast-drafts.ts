import {findUnsupportedInterpolations} from '@line-crm/shared';
import {sha256Hex} from '../middleware/auth.js';
import {GapError} from './gap-common.js';

export async function mcpBroadcastDraft(db:D1Database,input:{connectionId:string;account:string;tool:string;args:Record<string,unknown>;now:string}){
 const {args,account,connectionId,tool,now}=input;
 const allowed=['accountId','title','text','targetTagId',...(tool==='create_broadcast_draft'?['idempotencyKey']:['broadcastId','expectedVersion'])];
 if(Object.keys(args).some(k=>!allowed.includes(k))||typeof args.title!=='string'||!args.title.trim()||args.title.length>200||typeof args.text!=='string'||!args.text.trim()||args.text.length>5000||findUnsupportedInterpolations(args.text).length)throw new GapError('invalid_draft');
 if(args.targetTagId!==undefined&&(typeof args.targetTagId!=='string'||!await db.prepare('SELECT id FROM tags WHERE id=? AND line_account_id=? AND archived_at IS NULL').bind(args.targetTagId,account).first()))throw new GapError('invalid_tag');
 const content={title:args.title.trim(),text:args.text,targetTagId:args.targetTagId??null},fingerprint=await sha256Hex(JSON.stringify(content));
 const origin={createdVia:'mcp',mcpConnectionId:connectionId};
 if(tool==='create_broadcast_draft'){
  if(typeof args.idempotencyKey!=='string'||!/^[-\w:]{1,128}$/.test(args.idempotencyKey))throw new GapError('idempotency_key_required');
  const id='mcp-'+await sha256Hex(JSON.stringify([connectionId,account,args.idempotencyKey]));
  const payload=JSON.stringify({...origin,requestFingerprint:fingerprint});
  const result=await db.batch([
   db.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,draft_payload_json,status,created_at) SELECT ?,?,'text',?,?,?,?,?,'draft',? WHERE EXISTS(SELECT 1 FROM mcp_connections m JOIN staff_members s ON s.id=m.created_by AND s.tenant_id=m.organization_id WHERE m.id=? AND m.status='active' AND m.level IN('draft','send_request') AND julianday(m.expires_at)>julianday('now') AND s.is_active=1 AND s.role='owner' AND s.access_level='full') ON CONFLICT(id) DO NOTHING`).bind(id,content.title,content.text,content.targetTagId?'tag':'all',content.targetTagId,account,payload,now,connectionId),
   db.prepare("INSERT INTO broadcast_execution_contexts(broadcast_id,account_id,purpose,created_via,created_by,mcp_connection_id,request_key,request_fingerprint) SELECT ?,?,'marketing','mcp',created_by,id,?,? FROM mcp_connections WHERE id=? ON CONFLICT(broadcast_id) DO NOTHING").bind(id,account,'mcp:'+id,fingerprint,connectionId),
   db.prepare("INSERT INTO mcp_call_logs(id,connection_id,tool,account_id,kind,result,target_type,target_id,summary,at) SELECT ?,?,'create_broadcast_draft',?,'draft','ok','broadcast',?,'配信の下書きを作った',? WHERE changes()=1").bind(crypto.randomUUID(),connectionId,account,id,now),
  ]);
  const row=await db.prepare('SELECT draft_payload_json FROM broadcasts WHERE id=? AND line_account_id=?').bind(id,account).first<{draft_payload_json:string}>();
  if(!row||JSON.parse(row.draft_payload_json??'{}').requestFingerprint!==fingerprint)throw new GapError('idempotency_conflict',409);
  return {broadcastId:id,version:1,createdVia:'mcp',connectionId,sent:false,replayed:!result[0].meta.changes};
 }
 if(typeof args.broadcastId!=='string'||!Number.isSafeInteger(args.expectedVersion)||Number(args.expectedVersion)<1)throw new GapError('invalid_version');
 const result=await db.batch([
  db.prepare(`UPDATE broadcasts SET title=?,message_content=?,target_type=?,target_tag_id=?,lock_version=lock_version+1 WHERE id=? AND line_account_id=? AND status='draft' AND approval_status='none' AND lock_version=? AND EXISTS(SELECT 1 FROM mcp_connections m JOIN staff_members s ON s.id=m.created_by WHERE m.id=? AND m.status='active' AND m.level IN('draft','send_request') AND julianday(m.expires_at)>julianday('now') AND s.is_active=1 AND s.role='owner' AND s.access_level='full') AND EXISTS(SELECT 1 FROM mcp_call_logs WHERE connection_id=? AND tool='create_broadcast_draft' AND result='ok' AND target_type='broadcast' AND target_id=broadcasts.id AND account_id=?)`).bind(content.title,content.text,content.targetTagId?'tag':'all',content.targetTagId,args.broadcastId,account,args.expectedVersion,connectionId,connectionId,account),
  db.prepare("INSERT INTO mcp_call_logs(id,connection_id,tool,account_id,kind,result,target_type,target_id,summary,at) SELECT ?,?,'update_broadcast_draft',?,'draft','ok','broadcast',?,'配信の下書きを直した',? WHERE changes()=1").bind(crypto.randomUUID(),connectionId,account,args.broadcastId,now),
 ]);
 if(!result[0].meta.changes)throw new GapError('version_conflict_or_forbidden',409);
 return {broadcastId:args.broadcastId,version:Number(args.expectedVersion)+1,createdVia:'mcp',connectionId,sent:false};
}
