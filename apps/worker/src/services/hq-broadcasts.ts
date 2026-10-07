import { getLineAccountById, getStaffById, getBroadcastById, getRetryableRecipientIds,
  reopenFailedClaims, closeClaimsForStop, type SegmentCondition } from '@line-crm/db';
import type { HqBroadcastInput, HqBroadcastPreflight, HqBroadcastRun } from '@line-crm/shared';
import { requireHqTemplateAuthority } from './hq-templates/contract.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { StampError, stampId } from './visit-stamps.js';
import { fetchQuota } from './broadcast-quota-guard.js';
import { parseBroadcastMessageParts, buildMessages, unsupportedMessageVariables } from './broadcast-message-set.js';
import { resolveSendCommonVars } from './interpolation-context.js';
import { isOperationCapabilityStopped } from '@line-crm/db';
import { featureJobCanRun } from './feature-enforcement.js';

type RunRow={id:string;tenant_id:string;actor_id:string;input_json:string;status:string;version:number;scheduled_at:string|null;dispatch_token:string|null};
type Target={run_id:string;line_account_id:string;account_name:string;tag_id:string|null;excluded:number;broadcast_id:string|null;preflight_json:string|null};
export async function hqBroadcastAuthority(db:D1Database,staff:AuthenticatedStaff|undefined) {
  if(!staff?.tenantId)throw new StampError('統括の編集権限が必要です',403);
  const member=await getStaffById(db,staff.id);
  if(!member||member.tenant_id!==staff.tenantId||!member.is_active)throw new StampError('統括の編集権限が必要です',403);
  const result=requireHqTemplateAuthority({tenantId:staff.tenantId,actorId:staff.id,role:member.role,
    readOnly:staff.readOnly||member.access_level==='read_only',accountScoped:member.account_scope==='accounts'});
  if(result.kind!=='AUTHORIZED')throw new StampError('統括全体の編集権限が必要です',403);return result.authority;
}
export async function getHqBroadcastRun(db:D1Database,tenantId:string,id:string):Promise<RunRow> {
  const r=await db.prepare('SELECT * FROM hq_broadcast_runs WHERE id=? AND tenant_id=?').bind(stampId(id),tenantId).first<RunRow>();
  if(!r)throw new StampError('統括配信が見つかりません',404);return r;
}
export function expandAccountName(content:string,name:string,isJson=false):string {
  if(!isJson)return content.replace(/\{\{\s*account\.name\s*\}\}/g,()=>name);
  const tree:unknown=JSON.parse(content);
  const walk=(v:unknown):unknown=>typeof v==='string'?expandAccountName(v,name):Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,val])=>[k,walk(val)])):v;
  return JSON.stringify(walk(tree));
}
function mappedContent(input:HqBroadcastInput,name:string) {
  return {messageContent:expandAccountName(input.messageContent,name,!['text','image','audio','video'].includes(input.messageType)),
    messageBubblesJson:input.messageBubblesJson?expandAccountName(input.messageBubblesJson,name,true):null,
    altText:input.altText?expandAccountName(input.altText,name):null};
}
function condition(tagId:string|null):SegmentCondition {
  return {operator:'AND',rules:[{type:'is_following',value:true},...(tagId?[{type:'tag_exists' as const,value:tagId}]:[])]};
}
export async function prepareHqBroadcast(db:D1Database,tenantId:string,actorId:string,b:HqBroadcastInput) {
  if(!b||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||typeof b.messageContent!=='string'||!b.messageContent.trim()||b.messageContent.length>200000)throw new StampError('配信名と本文を確認してください');
  stampId(b.requestId);
  for(const ids of [b.accountIds,b.accountTagIds,b.excludedAccountIds])if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length)throw new StampError('店舗・分類を確認してください');else ids.forEach(stampId);
  if(!b.accountIds.length&&!b.accountTagIds.length)throw new StampError('対象店か分類を選んでください');
  if(!b.audience||!['all','tag'].includes(b.audience.kind)||(b.audience.kind==='tag'&&(typeof b.audience.tagName!=='string'||!b.audience.tagName.trim()||b.audience.tagName.length>100)))throw new StampError('全員か、同じ名前のタグを選んでください');
  if(!['text','image','video','audio','flex','sticker','location','carousel'].includes(b.messageType))throw new StampError('本文の種類を確認してください');
  try {const content=mappedContent(b,'確認用の店名'),parts=parseBroadcastMessageParts({...b,...content});buildMessages(parts);if(unsupportedMessageVariables(parts).length)throw new Error();}
  catch {throw new StampError('本文・差し込みの形式を確認してください');}
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(b).sort(([a],[z])=>a.localeCompare(z)))),existing=await db.prepare('SELECT id,input_json FROM hq_broadcast_runs WHERE tenant_id=? AND request_id=?').bind(tenantId,b.requestId).first<{id:string;input_json:string}>();
  if(existing){if(existing.input_json!==canonical)throw new StampError('同じ実行の依頼で内容が変わっています',409);return getHqBroadcastRun(db,tenantId,existing.id);}
  if(b.scheduledAt!==null&&(typeof b.scheduledAt!=='string'||!Number.isFinite(Date.parse(b.scheduledAt))||Date.parse(b.scheduledAt)<=Date.now()))throw new StampError('予約日時は未来にしてください');
  for(const tag of b.accountTagIds)if(!await db.prepare('SELECT id FROM line_account_tags WHERE id=? AND tenant_id=?').bind(tag,tenantId).first())throw new StampError('分類を確認してください',403);
  const all=(await db.prepare('SELECT id,name FROM line_accounts WHERE tenant_id=? AND archived_at IS NULL').bind(tenantId).all<{id:string;name:string}>()).results;
  for(const id of [...b.accountIds,...b.excludedAccountIds])if(!all.some(a=>a.id===id))throw new StampError('店舗を確認してください',403);
  const tagged=b.accountTagIds.length?(await db.prepare(`SELECT DISTINCT line_account_id FROM line_account_tag_links WHERE tenant_id=? AND tag_id IN (${b.accountTagIds.map(()=>'?').join(',')})`).bind(tenantId,...b.accountTagIds).all<{line_account_id:string}>()).results.map(x=>x.line_account_id):[];
  const selected=all.filter(a=>[...b.accountIds,...tagged].includes(a.id));if(!selected.length)throw new StampError('対象店がありません');
  const id=crypto.randomUUID(),statements=[db.prepare('INSERT INTO hq_broadcast_runs(id,tenant_id,request_id,actor_id,input_json,scheduled_at) VALUES(?,?,?,?,?,?)').bind(id,tenantId,b.requestId,actorId,canonical,b.scheduledAt)];
  for(const a of selected) {
    let tag:string|null=null;if(b.audience.kind==='tag'){
      const tags=(await db.prepare('SELECT id FROM tags WHERE line_account_id=? AND name=?').bind(a.id,b.audience.tagName.trim()).all<{id:string}>()).results;
      if(tags.length===1)tag=tags[0].id;
    }
    statements.push(db.prepare('INSERT INTO hq_broadcast_targets(run_id,line_account_id,account_name,tag_id,excluded) VALUES(?,?,?,?,?)').bind(id,a.id,a.name,tag,b.excludedAccountIds.includes(a.id)?1:0));
    statements.push(db.prepare('INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,a.id,actorId,'target_fixed'));
  }
  try {await db.batch(statements);}catch(e){const winner=await db.prepare('SELECT id,input_json FROM hq_broadcast_runs WHERE tenant_id=? AND request_id=?').bind(tenantId,b.requestId).first<{id:string;input_json:string}>();if(!winner)throw e;if(winner.input_json!==canonical)throw new StampError('同じ実行の依頼で内容が変わっています',409);return getHqBroadcastRun(db,tenantId,winner.id);}
  return getHqBroadcastRun(db,tenantId,id);
}
export async function preflightHqBroadcast(db:D1Database,run:RunRow):Promise<HqBroadcastPreflight[]> {
  const input=JSON.parse(run.input_json) as HqBroadcastInput,targets=(await db.prepare('SELECT * FROM hq_broadcast_targets WHERE run_id=? ORDER BY line_account_id').bind(run.id).all<Target>()).results;
  const result:HqBroadcastPreflight[]=[];
  for(const t of targets) {
    const reasons:string[]=[];
    const account=await getLineAccountById(db,t.line_account_id);
    const paused=!account||!account.is_active||!!account.archived_at||!await featureJobCanRun(db,{accountId:t.line_account_id,featureId:'broadcasts',job:'broadcast deliveries'})
      ||await isOperationCapabilityStopped(db,t.line_account_id,'broadcast_dispatch');
    if(paused)reasons.push('店舗または配信が停止中');
    const connected=!!account?.channel_access_token;
    if(!connected)reasons.push('LINEに接続されていません');
    if(input.audience.kind==='tag'&&!t.tag_id)reasons.push('同じ名前のタグが1件だけ見つかりません');
    const audience=await db.prepare(`SELECT COUNT(*) AS count FROM friends f WHERE f.line_account_id=? AND f.is_following=1 AND COALESCE(f.is_hidden,0)=0
      AND f.line_user_id IS NOT NULL AND f.line_user_id<>'' AND (? IS NULL OR EXISTS(SELECT 1 FROM friend_tags ft WHERE ft.friend_id=f.id AND ft.tag_id=?))`)
      .bind(t.line_account_id,t.tag_id,t.tag_id).first<{count:number}>();
    const quota=connected?await fetchQuota(account!.channel_access_token):{limit:null,used:null};
    const remaining=quota.limit===null||quota.used===null?null:Math.max(0,quota.limit-quota.used);
    // APIエラーも接続不明として人に返す。別の店舗の枠では補えない。
    if(remaining===null)reasons.push('今月の送信枠・LINE接続を確認できません');
    else if(audience!.count>remaining)reasons.push('今月の送信枠が足りません');
    try {const content=mappedContent(input,account?.name??t.account_name),parts=parseBroadcastMessageParts({...input,...content});for(const p of parts)await resolveSendCommonVars(db,t.line_account_id,p.messageContent,{kind:'broadcast',id:run.id});}
    catch {reasons.push('店舗の共通情報を確認してください');}
    const p={accountId:t.line_account_id,accountName:account?.name??t.account_name,audienceCount:input.audience.kind==='tag'&&!t.tag_id?0:audience!.count,remaining,connected:connected&&remaining!==null,paused,blockedReasons:reasons,excluded:!!t.excluded,broadcastId:t.broadcast_id};
    result.push(p);
    await db.prepare('UPDATE hq_broadcast_targets SET preflight_json=? WHERE run_id=? AND line_account_id=?').bind(JSON.stringify(p),run.id,t.line_account_id).run();
  }
  return result;
}
export async function excludeHqBroadcastTargets(db:D1Database,run:RunRow,actorId:string,ids:string[],version:number) {
  if(!Array.isArray(ids)||ids.length>100||!Number.isSafeInteger(version))throw new StampError('除外する店舗と版を確認してください');ids.forEach(stampId);
  const targets=(await db.prepare('SELECT line_account_id FROM hq_broadcast_targets WHERE run_id=?').bind(run.id).all<{line_account_id:string}>()).results;
  if(ids.some(x=>!targets.some(t=>t.line_account_id===x)))throw new StampError('固定した対象以外の店は選べません');
  const token=crypto.randomUUID();const ops=[db.prepare(`UPDATE hq_broadcast_runs SET version=version+1,dispatch_token=? WHERE id=? AND status='prepared' AND version=?`).bind(token,run.id,version)];
  for(const t of targets){ops.push(db.prepare(`UPDATE hq_broadcast_targets SET excluded=? WHERE run_id=? AND line_account_id=? AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(ids.includes(t.line_account_id)?1:0,run.id,t.line_account_id,run.id,token));
    ops.push(db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(crypto.randomUUID(),run.id,t.line_account_id,actorId,ids.includes(t.line_account_id)?'excluded':'included',run.id,token));}
  const r=await db.batch(ops);if(!r[0].meta.changes)throw new StampError('対象店が更新されました。読み直してください',409);
}
export async function dispatchHqBroadcast(db:D1Database,run:RunRow,actorId:string,version:number) {
  if(run.status!=='prepared')return readHqBroadcastResult(db,run);
  const preflight=await preflightHqBroadcast(db,run),selected=preflight.filter(p=>!p.excluded);
  if(!selected.length||selected.some(p=>p.blockedReasons.length))throw new StampError('送れない店舗を外して再確認してください',409);
  const input=JSON.parse(run.input_json) as HqBroadcastInput,at=input.scheduledAt??new Date().toISOString(),token=crypto.randomUUID();
  const ops=[db.prepare("UPDATE hq_broadcast_runs SET status='scheduled',version=version+1,dispatch_token=?,updated_at=datetime('now') WHERE id=? AND status='prepared' AND version=?").bind(token,run.id,version)];
  const targets=(await db.prepare('SELECT * FROM hq_broadcast_targets WHERE run_id=?').bind(run.id).all<Target>()).results;
  for(const p of selected){const t=targets.find(t=>t.line_account_id===p.accountId)!,broadcastId=crypto.randomUUID();
    ops.push(db.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,message_bubbles_json,target_type,status,scheduled_at,line_account_id,alt_text,segment_conditions,hq_run_id)
      SELECT ?,?,?,?,?,'segment','scheduled',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`)
      .bind(broadcastId,input.title,input.messageType,input.messageContent,input.messageBubblesJson??null,at,p.accountId,input.altText??null,JSON.stringify(condition(t.tag_id)),run.id,run.id,token));
    ops.push(db.prepare(`UPDATE hq_broadcast_targets SET broadcast_id=? WHERE run_id=? AND line_account_id=? AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(broadcastId,run.id,p.accountId,run.id,token));
    ops.push(db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,?,?,'scheduled' WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(crypto.randomUUID(),run.id,p.accountId,actorId,run.id,token));
  }
  const result=await db.batch(ops);if(!result[0].meta.changes)throw new StampError('別の担当者が先に操作しました',409);
  return readHqBroadcastResult(db,await getHqBroadcastRun(db,run.tenant_id,run.id));
}
export async function readHqBroadcastResult(db:D1Database,run:RunRow):Promise<HqBroadcastRun> {
  const input=JSON.parse(run.input_json) as HqBroadcastInput,rows=(await db.prepare(`SELECT t.*,b.status AS child_status,b.total_count,b.success_count,b.stopped_at,b.lock_version,
    (SELECT COUNT(*) FROM broadcast_send_claims s WHERE s.broadcast_id=b.id AND s.state='failed' AND s.error_code IN ('line_http_429','stopped_before_dispatch')) AS retryable_count
    FROM hq_broadcast_targets t LEFT JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=? ORDER BY t.line_account_id`).bind(run.id).all<Target & {child_status:string|null;total_count:number|null;success_count:number|null;stopped_at:string|null;retryable_count:number;lock_version:number|null}>()).results;
  return {id:run.id,title:input.title,status:run.status,version:run.version,scheduledAt:run.scheduled_at,targets:rows.map(r=>({...(r.preflight_json?JSON.parse(r.preflight_json):{accountId:r.line_account_id,accountName:r.account_name,audienceCount:null,remaining:null,connected:false,paused:false,blockedReasons:[]}),excluded:!!r.excluded,broadcastId:r.broadcast_id,status:r.excluded?'excluded':(run.status==='cancelled'?'cancelled':r.child_status==='draft'&&run.status!=='prepared'?'failed':r.child_status??'prepared'),successCount:r.success_count??0,totalCount:r.total_count??0,version:r.lock_version??1,retryableCount:r.retryable_count,stopped:!!r.stopped_at}))};
}
export async function stopHqBroadcast(db:D1Database,run:RunRow,actorId:string,cancel:boolean,version:number) {
  const token=crypto.randomUUID(),ops=[db.prepare(`UPDATE hq_broadcast_runs SET status=?,version=version+1,dispatch_token=? WHERE id=? AND version=? AND status NOT IN ('cancelled')`).bind(cancel?'cancelled':'stopped',token,run.id,version)];
  const targets=(await db.prepare('SELECT * FROM hq_broadcast_targets WHERE run_id=?').bind(run.id).all<Target>()).results;
  for(const t of targets){if(t.broadcast_id)ops.push(db.prepare(`UPDATE broadcasts SET status=CASE WHEN status='scheduled' THEN 'draft' ELSE status END,scheduled_at=NULL,
    stopped_at=COALESCE(stopped_at,datetime('now')),stopped_by=?,lock_version=lock_version+1 WHERE id=? AND status IN ('scheduled','sending') AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(actorId,t.broadcast_id,run.id,token));
    ops.push(db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(crypto.randomUUID(),run.id,t.line_account_id,actorId,cancel?'cancelled':'stopped',run.id,token));}
  const r=await db.batch(ops);if(!r[0].meta.changes)throw new StampError('別の担当者が先に操作しました',409);
  for(const t of targets)if(t.broadcast_id)await closeClaimsForStop(db,t.broadcast_id);
  return readHqBroadcastResult(db,await getHqBroadcastRun(db,run.tenant_id,run.id));
}
export async function retryHqBroadcastTarget(db:D1Database,run:RunRow,accountId:string,actorId:string,version:number) {
  if(run.status==='cancelled')throw new StampError('取り消した配信はやり直せません',409);
  const t=await db.prepare('SELECT broadcast_id FROM hq_broadcast_targets WHERE run_id=? AND line_account_id=? AND excluded=0').bind(run.id,stampId(accountId)).first<{broadcast_id:string|null}>();
  if(!t?.broadcast_id)throw new StampError('店舗の配信が見つかりません',404);
  const broadcast=await getBroadcastById(db,t.broadcast_id);if(!broadcast)throw new StampError('配信が見つかりません',404);
  const check=(await preflightHqBroadcast(db,run)).find(p=>p.accountId===accountId);if(check?.blockedReasons.length)throw new StampError('店舗の送信前確認に問題があります',409);
  if(broadcast.status==='draft') {
    const prior=await db.prepare(`SELECT 1 FROM broadcast_send_claims WHERE broadcast_id=? AND state IN ('sent','unknown','claimed') LIMIT 1`).bind(broadcast.id).first();
    if(prior)throw new StampError('送達の状態を確認する必要があります',409);
    const changed=await db.prepare(`UPDATE broadcasts SET status='scheduled',scheduled_at=?,stopped_at=NULL,stopped_by=NULL,lock_version=lock_version+1
      WHERE id=? AND status='draft' AND lock_version=? AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND status<>'cancelled')`).bind(new Date().toISOString(),broadcast.id,version,run.id).run();
    if(!changed.meta.changes)throw new StampError('配信が更新されました',409);
    await db.prepare('INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),run.id,accountId,actorId,'retry_before_delivery').run();
    return readHqBroadcastResult(db,await getHqBroadcastRun(db,run.tenant_id,run.id));
  }
  const recipients=await getRetryableRecipientIds(db,broadcast.id);if(!recipients.length)throw new StampError('やり直せる一時的な失敗がありません',409);
  const changed=await db.prepare(`UPDATE broadcasts SET send_attempt_no=send_attempt_no+1,status='sending',sent_at=NULL,stopped_at=NULL,stopped_by=NULL,
    batch_offset=0,batch_lock_at=NULL,lock_version=lock_version+1 WHERE id=? AND lock_version=? AND (status='sent' OR (status='sending' AND stopped_at IS NOT NULL))
    AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND status<>'cancelled')`).bind(broadcast.id,version,run.id).run();
  if(!changed.meta.changes)throw new StampError('配信が更新されました。読み直してください',409);
  const updated=await getBroadcastById(db,broadcast.id);
  await reopenFailedClaims(db,broadcast.id,updated!.send_attempt_no!);
  await db.prepare('INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),run.id,accountId,actorId,'retry_failed').run();
  return readHqBroadcastResult(db,run);
}
