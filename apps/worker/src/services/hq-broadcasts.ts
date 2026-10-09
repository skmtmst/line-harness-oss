import { resolveHqBroadcastAudience, countHqAudience } from './hq-broadcast-audience.js';
import { hqBroadcastApprovalState } from './hq-broadcast-approval.js';
import { getLineAccountById, getStaffById, getBroadcastById, getRetryableRecipientIds,
  reopenFailedClaims, closeClaimsForStop } from '@line-crm/db';
import type { HqBroadcastInput, HqBroadcastPreflight, HqBroadcastRun } from '@line-crm/shared';
import { requireHqTemplateAuthority } from './hq-templates/contract.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { StampError, stampId } from './visit-stamps.js';
import { fetchQuota } from './broadcast-quota-guard.js';
import { parseBroadcastMessageParts, buildMessages, unsupportedMessageVariables } from './broadcast-message-set.js';
import { resolveSendCommonVars } from './interpolation-context.js';
import { isOperationCapabilityStopped } from '@line-crm/db';
import { featureJobCanRun } from './feature-enforcement.js';
import { resolveHqBroadcastMaterials } from './hq-broadcast-materials.js';

type RunRow={id:string;tenant_id:string;actor_id:string;input_json:string;status:string;version:number;scheduled_at:string|null;dispatch_token:string|null;approval_json:string|null};
type Target={run_id:string;line_account_id:string;account_name:string;tag_id:string|null;excluded:number;broadcast_id:string|null;preflight_json:string|null};
export async function hqBroadcastAuthority(db:D1Database,staff:AuthenticatedStaff|undefined, read=false) {
  if(!staff?.tenantId)throw new StampError('統括の編集権限が必要です',403);
  const member=await getStaffById(db,staff.id);
  if(!member||member.tenant_id!==staff.tenantId||!member.is_active)throw new StampError('統括の編集権限が必要です',403);
  const result=requireHqTemplateAuthority({tenantId:staff.tenantId,actorId:staff.id,role:member.role,
    readOnly:!read&&(staff.readOnly||member.access_level==='read_only'),accountScoped:member.account_scope==='accounts'});
  if(result.kind!=='AUTHORIZED')throw new StampError('統括全体の編集権限が必要です',403);return result.authority;
}
export async function getHqBroadcastRun(db:D1Database,tenantId:string,id:string):Promise<RunRow> {
  const r=await db.prepare('SELECT * FROM hq_broadcast_runs WHERE id=? AND tenant_id=?').bind(stampId(id),tenantId).first<RunRow>();
  if(!r)throw new StampError('統括配信が見つかりません',404);return r;
}
function expandHqVariables(content:string,name:string,liffId:string|null|undefined,isJson=false):string {
  const plain=(value:string)=>value.replace(/\{\{\s*account\.name\s*\}\}/g,()=>name)
    .replace(/\{\{\s*liff_id\s*\}\}/g,match=>liffId??match);
  if(!isJson)return plain(content);
  const walk=(value:unknown,key=''):unknown=>{
    if(typeof value==='string') {
      // 吹き出し内のJSON文字列にも、文字列の値だけを差し込む。
      if(/Json$/.test(key)) return JSON.stringify(walk(JSON.parse(value)));
      return plain(value);
    }
    if(Array.isArray(value))return value.map(item=>walk(item));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v,k)]));
    return value;
  };
  return JSON.stringify(walk(JSON.parse(content)));
}
export function expandAccountName(content:string,name:string,isJson=false):string {
  return expandHqVariables(content,name,null,isJson);
}
export function mappedHqContent(input:HqBroadcastInput,name:string,liffId?:string|null) {
  return {messageBubbles:undefined,
    messageContent:expandHqVariables(input.messageContent,name,liffId,!['text','image','audio','video'].includes(input.messageType)),
    messageBubblesJson:input.messageBubbles ? expandHqVariables(JSON.stringify(input.messageBubbles),name,liffId,true)
      :input.messageBubblesJson?expandHqVariables(input.messageBubblesJson,name,liffId,true):null,
    messageOptionsJson:input.messageOptions?expandHqVariables(JSON.stringify(input.messageOptions),name,liffId,true):null,
    altText:input.altText?expandHqVariables(input.altText,name,liffId):null};
}
export async function prepareHqBroadcast(db:D1Database,tenantId:string,actorId:string,b:HqBroadcastInput, update?:{run:RunRow;expectedVersion:number}) {
  if(!b||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||typeof b.messageContent!=='string'||(!b.messageContent.trim()&&!b.messageBubbles&&!b.messageBubblesJson)||b.messageContent.length>200000)throw new StampError('配信名と本文を確認してください');
  stampId(b.requestId);
  if(b.targetType!==undefined&&!['all','tag','segment'].includes(b.targetType))throw new StampError('配信対象の種類を確認してください');
  if(b.targetType==='multi-account-dedup'||b.afterActionVersionId)throw new StampError('配布先の店で決める設定は指定できません');
  if(b.internalMemo!=null&&(typeof b.internalMemo!=='string'||b.internalMemo.length>10000))throw new StampError('社内メモを確認してください');
  if(b.excludedTagIds!==undefined&&(!Array.isArray(b.excludedTagIds)||b.excludedTagIds.length>100||b.excludedTagIds.some(v=>typeof v!=='string')))throw new StampError('除くタグを確認してください');
  if(b.folderId&&!await db.prepare('SELECT id FROM hq_broadcast_folders WHERE id=? AND tenant_id=? AND archived_at IS NULL').bind(b.folderId,tenantId).first())throw new StampError('分類を確認してください',403);
  if(b.messageBubbles&&b.messageBubblesJson)throw new StampError('吹き出しは1つの形式で指定してください');
  if(b.trackLinks!==undefined&&typeof b.trackLinks!=='boolean'||b.measureOpens!==undefined&&typeof b.measureOpens!=='boolean')throw new StampError('計測設定を確認してください');
  if(b.stealthSpreadMinutes!==undefined&&(!Number.isInteger(b.stealthSpreadMinutes)||b.stealthSpreadMinutes<0||b.stealthSpreadMinutes>1440))throw new StampError('配信時間を確認してください');
  if(update&&(!Number.isSafeInteger(update.expectedVersion)||update.expectedVersion<1))throw new StampError('読み込んだ版を指定してください');
  if(update&&(update.run.status!=='prepared'||b.requestId!==(JSON.parse(update.run.input_json) as HqBroadcastInput).requestId))throw new StampError('下書きだけ変更できます。同じ依頼番号を使ってください',409);
  for(const ids of [b.accountIds,b.accountTagIds,b.excludedAccountIds])if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length)throw new StampError('店舗・分類を確認してください');else ids.forEach(stampId);
  if(!b.accountIds.length&&!b.accountTagIds.length)throw new StampError('対象店か分類を選んでください');
  if(!b.audience||!['all','tag'].includes(b.audience.kind)||(b.audience.kind==='tag'&&(typeof b.audience.tagName!=='string'||!b.audience.tagName.trim()||b.audience.tagName.length>100)))throw new StampError('全員か、同じ名前のタグを選んでください');
  if(!['text','image','video','audio','flex','sticker','location','carousel','imagemap','rich_message','card_message','coupon','research'].includes(b.messageType))throw new StampError('本文の種類を確認してください');
  try {const content=mappedHqContent(b,'確認用の店名'),parts=parseBroadcastMessageParts({...b,...content});buildMessages(parts);if(unsupportedMessageVariables(parts).length)throw new Error();}
  catch {throw new StampError('本文・差し込みの形式を確認してください');}
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(b).sort(([a],[z])=>a.localeCompare(z)))),existing=await db.prepare('SELECT id,input_json FROM hq_broadcast_runs WHERE tenant_id=? AND request_id=?').bind(tenantId,b.requestId).first<{id:string;input_json:string}>();
  if(existing&&!update){if(existing.input_json!==canonical)throw new StampError('同じ実行の依頼で内容が変わっています',409);return getHqBroadcastRun(db,tenantId,existing.id);}
  if(b.scheduledAt!==null&&(typeof b.scheduledAt!=='string'||!Number.isFinite(Date.parse(b.scheduledAt))||Date.parse(b.scheduledAt)<=Date.now()))throw new StampError('予約日時は未来にしてください');
  for(const tag of b.accountTagIds)if(!await db.prepare('SELECT id FROM line_account_tags WHERE id=? AND tenant_id=?').bind(tag,tenantId).first())throw new StampError('分類を確認してください',403);
  const all=(await db.prepare('SELECT id,name FROM line_accounts WHERE tenant_id=? AND archived_at IS NULL').bind(tenantId).all<{id:string;name:string}>()).results;
  for(const id of [...b.accountIds,...b.excludedAccountIds])if(!all.some(a=>a.id===id))throw new StampError('店舗を確認してください',403);
  const tagged=b.accountTagIds.length?(await db.prepare(`SELECT DISTINCT line_account_id FROM line_account_tag_links WHERE tenant_id=? AND tag_id IN (${b.accountTagIds.map(()=>'?').join(',')})`).bind(tenantId,...b.accountTagIds).all<{line_account_id:string}>()).results.map(x=>x.line_account_id):[];
  const selected=all.filter(a=>[...b.accountIds,...tagged].includes(a.id));if(!selected.length)throw new StampError('対象店がありません');
  const id=update?.run.id??crypto.randomUUID(),token=crypto.randomUUID(),statements=[db.prepare('INSERT INTO hq_broadcast_runs(id,tenant_id,request_id,actor_id,input_json,scheduled_at) VALUES(?,?,?,?,?,?)').bind(id,tenantId,b.requestId,actorId,canonical,b.scheduledAt)];
  if(update){
   statements.splice(0,1,db.prepare(`UPDATE hq_broadcast_runs SET input_json=?,scheduled_at=?,approval_json=NULL,version=version+1,dispatch_token=?,updated_at=datetime('now') WHERE id=? AND tenant_id=? AND status='prepared' AND version=?`).bind(canonical,b.scheduledAt,token,id,tenantId,update.expectedVersion));
   statements.push(db.prepare('DELETE FROM hq_broadcast_targets WHERE run_id=? AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)').bind(id,id,token));
  }
  for(const a of selected) {
    // 作成・更新でも条件の欠落を全員配信へ変えない。
    if(!b.excludedAccountIds.includes(a.id))await resolveHqBroadcastAudience(db,tenantId,a.id,b);
    let tag:string|null=null;if(b.audience.kind==='tag'){
      const tags=(await db.prepare('SELECT id FROM tags WHERE line_account_id=? AND name=?').bind(a.id,b.audience.tagName.trim()).all<{id:string}>()).results;
      if(tags.length===1)tag=tags[0].id;
    }
    statements.push(db.prepare(`INSERT INTO hq_broadcast_targets(run_id,line_account_id,account_name,tag_id,excluded) SELECT ?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(id,a.id,a.name,tag,b.excludedAccountIds.includes(a.id)?1:0,Number(!!update),id,token));
    statements.push(db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(crypto.randomUUID(),id,a.id,actorId,update?'draft_updated':'target_fixed',Number(!!update),id,token));
  }
  try {const result=await db.batch(statements);if(update&&!result[0].meta.changes)throw new StampError('下書きが更新されました。読み直してください',409);}catch(e){if(update)throw e;const winner=await db.prepare('SELECT id,input_json FROM hq_broadcast_runs WHERE tenant_id=? AND request_id=?').bind(tenantId,b.requestId).first<{id:string;input_json:string}>();if(!winner)throw e;if(winner.input_json!==canonical)throw new StampError('同じ実行の依頼で内容が変わっています',409);return getHqBroadcastRun(db,tenantId,winner.id);}
  return getHqBroadcastRun(db,tenantId,id);
}
export async function preflightHqBroadcast(db:D1Database,run:RunRow,persist=true):Promise<HqBroadcastPreflight[]> {
  const input=JSON.parse(run.input_json) as HqBroadcastInput,targets=(await db.prepare('SELECT * FROM hq_broadcast_targets WHERE run_id=? ORDER BY line_account_id').bind(run.id).all<Target>()).results;
  const result:HqBroadcastPreflight[]=[];
  for(const t of targets) {
    const reasons:string[]=[];
    const found=await getLineAccountById(db,t.line_account_id),account=found?.tenant_id===run.tenant_id?found:null;
    const paused=!account||!account.is_active||!!account.archived_at||!await featureJobCanRun(db,{accountId:t.line_account_id,featureId:'broadcasts',job:'broadcast deliveries'})
      ||await isOperationCapabilityStopped(db,t.line_account_id,'broadcast_dispatch');
    if(paused)reasons.push('店舗または配信が停止中');
    const connected=!!account?.channel_access_token;
    if(!connected)reasons.push('LINEに接続されていません');
    if(/\{\{\s*liff_id\s*\}\}/.test(JSON.stringify(input))&&!account?.liff_id)reasons.push('店舗のLIFF IDを確認してください');

    let audienceCount:number|null=null;
    try{audienceCount=await countHqAudience(db,t.line_account_id,await resolveHqBroadcastAudience(db,run.tenant_id,t.line_account_id,input));}
    catch(e){reasons.push(e instanceof StampError?e.message:'対象条件を確認できません');}
    if(audienceCount===0)reasons.push('友だちが0人です');
    const quota=connected?await fetchQuota(account!.channel_access_token):{limit:null,used:null};
    const remaining=quota.limit===null||quota.used===null?null:Math.max(0,quota.limit-quota.used);
    // APIエラーも接続不明として人に返す。別の店舗の枠では補えない。
    if(remaining===null)reasons.push('今月の送信枠・LINE接続を確認できません');
    else if(audienceCount!==null&&audienceCount>remaining)reasons.push('今月の送信枠が足りません');
    try {const materials=await resolveHqBroadcastMaterials(db,run.tenant_id,t.line_account_id,input),content=mappedHqContent(materials,account?.name??t.account_name,account?.liff_id),parts=parseBroadcastMessageParts({...materials,...content});for(const p of parts)await resolveSendCommonVars(db,t.line_account_id,p.messageContent,{kind:'broadcast',id:run.id});}
    catch(e) {reasons.push(e instanceof StampError?e.message:'店舗の共通情報を確認してください');}
    const p={accountId:t.line_account_id,accountName:account?.name??t.account_name,audienceCount,remaining,connected:connected&&remaining!==null,paused,blockedReasons:reasons,excluded:!!t.excluded,broadcastId:t.broadcast_id};
    result.push(p);
    if(persist)await db.prepare('UPDATE hq_broadcast_targets SET preflight_json=? WHERE run_id=? AND line_account_id=?').bind(JSON.stringify(p),run.id,t.line_account_id).run();
  }
  return result;
}
export async function excludeHqBroadcastTargets(db:D1Database,run:RunRow,actorId:string,ids:string[],version:number) {
  if(!Array.isArray(ids)||ids.length>100||!Number.isSafeInteger(version))throw new StampError('除外する店舗と版を確認してください');ids.forEach(stampId);
  const targets=(await db.prepare('SELECT line_account_id FROM hq_broadcast_targets WHERE run_id=?').bind(run.id).all<{line_account_id:string}>()).results;
  if(ids.some(x=>!targets.some(t=>t.line_account_id===x)))throw new StampError('固定した対象以外の店は選べません');
  const token=crypto.randomUUID();const ops=[db.prepare(`UPDATE hq_broadcast_runs SET approval_json=NULL,version=version+1,dispatch_token=? WHERE id=? AND status='prepared' AND version=?`).bind(token,run.id,version)];
  for(const t of targets){ops.push(db.prepare(`UPDATE hq_broadcast_targets SET excluded=? WHERE run_id=? AND line_account_id=? AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(ids.includes(t.line_account_id)?1:0,run.id,t.line_account_id,run.id,token));
    ops.push(db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(crypto.randomUUID(),run.id,t.line_account_id,actorId,ids.includes(t.line_account_id)?'excluded':'included',run.id,token));}
  const r=await db.batch(ops);if(!r[0].meta.changes)throw new StampError('対象店が更新されました。読み直してください',409);
}
export async function dispatchHqBroadcast(db:D1Database,run:RunRow,actorId:string,version:number, confirmedRecipientCount?:number) {
  if(run.status!=='prepared')return readHqBroadcastResult(db,run);
  const preflight=await preflightHqBroadcast(db,run),selected=preflight.filter(p=>!p.excluded);
  if(!selected.length||selected.some(p=>p.blockedReasons.length))throw new StampError('送れない店舗を外して再確認してください',409);
  const approval=await hqBroadcastApprovalState(db,run,actorId,preflight);
  if(approval.gate.required) {
    if(approval.gate.singleOperator&&confirmedRecipientCount!==approval.gate.recipientCount)throw new StampError('送る人数を入力して確認してください',409);
    if(!approval.gate.singleOperator&&(approval.approval.status!=='approved'||approval.approval.confirmedCount!==approval.gate.recipientCount))throw new StampError('別の担当者の承認が必要です。人数が変わった場合は再承認してください',409);
  }
  const input=JSON.parse(run.input_json) as HqBroadcastInput,at=input.scheduledAt??new Date().toISOString(),token=crypto.randomUUID();
  const ops=[db.prepare("UPDATE hq_broadcast_runs SET status='scheduled',version=version+1,dispatch_token=?,updated_at=datetime('now') WHERE id=? AND status='prepared' AND version=?").bind(token,run.id,version)];
  for(const p of selected){const broadcastId=crypto.randomUUID();
    const resolved=await resolveHqBroadcastAudience(db,run.tenant_id,p.accountId,input);
    const account=await getLineAccountById(db,p.accountId);
    if(!account||account.tenant_id!==run.tenant_id)throw new StampError('店舗を確認してください',409);
    const materials=await resolveHqBroadcastMaterials(db,run.tenant_id,p.accountId,input);
    const content=mappedHqContent(materials,account.name,account.liff_id);
    ops.push(db.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,message_bubbles_json,target_type,status,scheduled_at,line_account_id,alt_text,segment_conditions,hq_run_id,
      internal_memo,track_links,measure_opens,stealth_spread_minutes,message_options_json,approval_status,approval_requested_by_staff_id,approval_decided_by_staff_id,approval_confirmed_count)
      SELECT ?,?,?,?,?,'segment','scheduled',?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`)
      .bind(broadcastId,input.title,input.messageType,content.messageContent,content.messageBubblesJson,at,p.accountId,content.altText,JSON.stringify(resolved),run.id,
        input.internalMemo??null,Number(input.trackLinks!==false),Number(input.measureOpens!==false),input.stealthSpreadMinutes??0,content.messageOptionsJson,
        approval.gate.required?'approved':'none',approval.approval.requestedByStaffId,approval.approval.decidedByStaffId,p.audienceCount,run.id,token));
    ops.push(db.prepare(`UPDATE hq_broadcast_targets SET broadcast_id=? WHERE run_id=? AND line_account_id=? AND EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(broadcastId,run.id,p.accountId,run.id,token));
    ops.push(db.prepare(`INSERT INTO hq_broadcast_audit(id,run_id,line_account_id,actor_id,action) SELECT ?,?,?,?,'scheduled' WHERE EXISTS(SELECT 1 FROM hq_broadcast_runs WHERE id=? AND dispatch_token=?)`).bind(crypto.randomUUID(),run.id,p.accountId,actorId,run.id,token));
  }
  const result=await db.batch(ops);if(!result[0].meta.changes)throw new StampError('別の担当者が先に操作しました',409);
  return readHqBroadcastResult(db,await getHqBroadcastRun(db,run.tenant_id,run.id));
}
export async function readHqBroadcastResult(db:D1Database,run:RunRow):Promise<HqBroadcastRun> {
  const input=JSON.parse(run.input_json) as HqBroadcastInput,rows=(await db.prepare(`SELECT t.*,b.status AS child_status,b.total_count,b.success_count,b.stopped_at,b.lock_version,b.approval_status,
    (SELECT unique_impression FROM broadcast_insights i WHERE i.broadcast_id=b.id AND i.status='ready' ORDER BY fetched_at DESC,rowid DESC LIMIT 1) AS opened_count,
    (SELECT unique_click FROM broadcast_insights i WHERE i.broadcast_id=b.id AND i.status='ready' ORDER BY fetched_at DESC,rowid DESC LIMIT 1) AS clicked_count,
    CASE WHEN b.sent_at IS NULL THEN NULL ELSE (SELECT COUNT(DISTINCT m.friend_id) FROM messages_log m JOIN broadcast_send_claims s ON s.friend_id=m.friend_id AND s.broadcast_id=b.id AND s.state='sent'
      WHERE m.line_account_id=b.line_account_id AND m.direction='incoming' AND m.created_at>=b.sent_at) END AS reaction_count,
    (SELECT COUNT(*) FROM broadcast_send_claims s WHERE s.broadcast_id=b.id AND s.state='failed' AND s.error_code IN ('line_http_429','stopped_before_dispatch')) AS retryable_count
    FROM hq_broadcast_targets t JOIN line_accounts a ON a.id=t.line_account_id AND a.tenant_id=? LEFT JOIN broadcasts b ON b.id=t.broadcast_id WHERE t.run_id=? ORDER BY t.line_account_id`).bind(run.tenant_id,run.id).all<Target & {opened_count:number|null;clicked_count:number|null;reaction_count:number|null;approval_status:string|null;child_status:string|null;total_count:number|null;success_count:number|null;stopped_at:string|null;retryable_count:number;lock_version:number|null}>()).results;
  const failures=(await db.prepare(`SELECT t.line_account_id,s.state,s.error_code,COUNT(*) AS count FROM hq_broadcast_targets t JOIN broadcast_send_claims s ON s.broadcast_id=t.broadcast_id WHERE t.run_id=? AND s.state IN ('failed','unknown') GROUP BY t.line_account_id,s.state,s.error_code`).bind(run.id).all<{line_account_id:string;state:string;error_code:string|null;count:number}>()).results;
  return {input,id:run.id,title:input.title,status:run.status,version:run.version,scheduledAt:run.scheduled_at,targets:rows.map(r=>({...(r.preflight_json?JSON.parse(r.preflight_json):{accountId:r.line_account_id,accountName:r.account_name,audienceCount:null,remaining:null,connected:false,paused:false,blockedReasons:[]}),failureReasons:failures.filter(f=>f.line_account_id===r.line_account_id).map(f=>classifyHqFailure(f.state,f.error_code,f.count)).concat(r.child_status==='sent'&&r.total_count===0?[{code:'no_friends',label:'友だちが0人です',count:0,retryable:false}]:r.child_status==='draft'&&run.status==='scheduled'?[{code:'before_send_failed',label:'送信前の確認で止まりました。店舗の送信前確認をやり直してください',count:0,retryable:true}]:[]),excluded:!!r.excluded,broadcastId:r.broadcast_id,status:r.excluded?'excluded':(run.status==='cancelled'?'cancelled':r.child_status==='draft'&&run.status!=='prepared'?'failed':r.child_status??'prepared'),openedCount:r.opened_count,clickedCount:r.clicked_count,reactionCount:r.reaction_count,approvalStatus:r.approval_status??'none',successCount:r.success_count??0,totalCount:r.total_count??0,version:r.lock_version??1,retryableCount:r.retryable_count,stopped:!!r.stopped_at}))};
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

export function classifyHqFailure(state:string,errorCode:string|null,count:number) {
 if(state==='unknown')return {code:'delivery_unknown',label:'LINEの応答なし（届いたか確認が必要）',count,retryable:false};
 if(errorCode==='line_http_429')return {code:'line_busy',label:'LINEが混雑しています',count,retryable:true};
 if(errorCode==='stopped_before_dispatch')return {code:'stopped',label:'送信前に停止しました',count,retryable:true};
 if(errorCode?.startsWith('common_var'))return {code:'store_information_missing',label:'店の共通情報が不足しています',count,retryable:false};
 if(errorCode==='line_http_401'||errorCode==='line_http_403')return {code:'line_connection',label:'LINEの接続を確認してください',count,retryable:false};
 return {code:'send_failed',label:'LINEへ送れませんでした',count,retryable:false};
}
