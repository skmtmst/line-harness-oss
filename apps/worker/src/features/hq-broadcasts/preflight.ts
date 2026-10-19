import type { HqBroadcastInput, HqBroadcastPreflight } from '@line-crm/shared';
import { getLineAccountById, isOperationCapabilityStopped } from '@line-crm/db';
import type { HqMediaRuntime } from '../../services/hq-media.js';
import { StampError, stampId } from '../../services/visit-stamps.js';
import { fetchQuota } from '../broadcasts/broadcast-quota-guard/index.js';
import { parseBroadcastMessageParts } from '../broadcasts/broadcast-message-set/index.js';
import { resolveSendCommonVars } from '../../services/interpolation-context.js';
import { featureJobCanRun } from '../../services/feature-enforcement.js';
import { resolveHqBroadcastAudience, countHqAudience } from './hq-broadcast-audience.js';
import { hqAfterAction } from './hq-broadcast-after-actions.js';
import { resolveHqBroadcastMaterials } from './hq-broadcast-materials.js';
export type RunRow={id:string;tenant_id:string;actor_id:string;input_json:string;status:string;version:number;scheduled_at:string|null;dispatch_token:string|null;approval_json:string|null};

export type Target={run_id:string;line_account_id:string;account_name:string;tag_id:string|null;excluded:number;broadcast_id:string|null;preflight_json:string|null};

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

export async function preflightHqBroadcast(db:D1Database,run:RunRow,persist=true,runtime?:HqMediaRuntime):Promise<HqBroadcastPreflight[]> {
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

    let audienceCount:number|null=null,consentExcluded:number|null=null;
    try{const counts=await countHqAudience(db,t.line_account_id,await resolveHqBroadcastAudience(db,run.tenant_id,t.line_account_id,input));audienceCount=counts.count;consentExcluded=counts.consentExcluded;}
    catch(e){reasons.push(e instanceof StampError?e.message:'対象条件を確認できません');}
    if(audienceCount===0&&!consentExcluded)reasons.push('友だちが0人です');
    const quota=connected?await fetchQuota(account!.channel_access_token):{limit:null,used:null};
    const remaining=quota.limit===null||quota.used===null?null:Math.max(0,quota.limit-quota.used);
    // APIエラーも接続不明として人に返す。別の店舗の枠では補えない。
    if(remaining===null)reasons.push('今月の送信枠・LINE接続を確認できません');
    else if(audienceCount!==null&&audienceCount>remaining)reasons.push('今月の送信枠が足りません');
    try {const materials=await resolveHqBroadcastMaterials(db,run.tenant_id,t.line_account_id,input,runtime ? {...runtime,copy:false} : undefined),content=mappedHqContent(materials,account?.name??t.account_name,account?.liff_id),parts=parseBroadcastMessageParts({...materials,...content});for(const p of parts)await resolveSendCommonVars(db,t.line_account_id,p.messageContent,{kind:'broadcast',id:run.id});}
    catch(e) {reasons.push(e instanceof StampError?e.message:'店舗の共通情報を確認してください');}
    let afterAction:null|{versionId:string;name:string;versionNumber:number;actionCount:number}=null;
    try {const a=await hqAfterAction(db,input,t.line_account_id);if(a)afterAction={versionId:a.id,name:a.name,versionNumber:a.versionNumber,actionCount:a.actionCount};}catch(e){reasons.push(e instanceof StampError?e.message:'配信後の処理を確認してください');}
    const p={afterAction,accountId:t.line_account_id,accountName:account?.name??t.account_name,audienceCount,consentExcluded,warnings:consentExcluded? [`配信を止めている ${consentExcluded} 人には送りません。`]:[],remaining,connected:connected&&remaining!==null,paused,blockedReasons:reasons,excluded:!!t.excluded,broadcastId:t.broadcast_id};
    result.push(p);
    if(persist)await db.prepare('UPDATE hq_broadcast_targets SET preflight_json=? WHERE run_id=? AND line_account_id=?').bind(JSON.stringify(p),run.id,t.line_account_id).run();
  }
  return result;
}
