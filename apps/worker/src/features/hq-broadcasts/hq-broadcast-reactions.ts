import { hqBroadcastBlocks } from './hq-broadcast-blocks.js';
import type { HqBroadcastInput } from '@line-crm/shared';
import { getHqBroadcastRun,prepareHqBroadcast,readHqBroadcastResult } from '../../services/hq-broadcasts.js';
import { resolveHqBroadcastAudience,countHqAudience } from './hq-broadcast-audience.js';
import { StampError } from '../../services/visit-stamps.js';

type Run=Awaited<ReturnType<typeof getHqBroadcastRun>>;
/** Links count clicks from recorded successful recipients in a fixed 14-day window. */
export async function hqBroadcastReactions(db:D1Database,run:Run) {
  const links=(await db.prepare(`SELECT t.line_account_id account_id,b.id broadcast_id,l.id link_id,l.name,l.original_url,lm.label,b.sent_at,
    (SELECT COUNT(DISTINCT c.friend_id) FROM link_clicks c JOIN broadcast_send_claims s ON s.friend_id=c.friend_id AND s.broadcast_id=b.id AND s.line_account_id=t.line_account_id AND s.state='sent'
      WHERE c.tracked_link_id=l.id AND julianday(c.clicked_at)>=julianday(b.sent_at) AND julianday(c.clicked_at)<julianday(b.sent_at,'+14 days')) people,
    (SELECT COUNT(*) FROM link_clicks c JOIN broadcast_send_claims s ON s.friend_id=c.friend_id AND s.broadcast_id=b.id AND s.line_account_id=t.line_account_id AND s.state='sent'
      WHERE c.tracked_link_id=l.id AND julianday(c.clicked_at)>=julianday(b.sent_at) AND julianday(c.clicked_at)<julianday(b.sent_at,'+14 days')) clicks,
    (SELECT COUNT(*) FROM broadcast_send_claims s WHERE s.broadcast_id=b.id AND s.line_account_id=t.line_account_id AND s.state='sent') sent
    FROM hq_broadcast_targets t JOIN line_accounts a ON a.id=t.line_account_id AND a.tenant_id=?
    JOIN broadcasts b ON b.id=t.broadcast_id AND b.line_account_id=t.line_account_id
    JOIN broadcast_tracked_links lm ON lm.broadcast_id=b.id JOIN tracked_links l ON l.id=lm.tracked_link_id AND l.line_account_id=t.line_account_id
    WHERE t.run_id=? AND t.excluded=0 AND b.sent_at IS NOT NULL ORDER BY t.line_account_id,l.id`).bind(run.tenant_id,run.id).all<{account_id:string;broadcast_id:string;link_id:string;name:string;original_url:string;label:string;sent_at:string;people:number;clicks:number;sent:number}>()).results;
  return {windowDays:14,minimumPeople:20,sampleBasis:'sent_recipients',links:links.map(r=>({accountId:r.account_id,broadcastId:r.broadcast_id,linkId:r.link_id,label:r.label||r.name,url:r.original_url,uniqueClickCount:r.sent>=20?r.people:null,clickCount:r.sent>=20?r.clicks:null,clickRate:r.sent>=20&&r.sent>0?Math.round(r.people/r.sent*1000)/10:null,suppressed:r.sent<20})),...await hqBroadcastBlocks(db,run.tenant_id,run.id)};
}

/** Create a draft only. Approval and send confirmation remain separate operations. */
export async function copyHqBroadcast(db:D1Database,run:Run,actorId:string,input:Record<string,unknown>,followup:boolean) {
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion!==run.version)throw new StampError('配信が変わりました。読み直してください',409);
  if(typeof input.requestId!=='string')throw new StampError('作成依頼の番号を指定してください',400);
  const source=JSON.parse(run.input_json) as HqBroadcastInput;
  let accountIds=source.accountIds;
  if(followup) {
    accountIds=(await db.prepare(`SELECT t.line_account_id FROM hq_broadcast_targets t JOIN line_accounts a ON a.id=t.line_account_id AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL
      JOIN broadcasts b ON b.id=t.broadcast_id AND b.line_account_id=t.line_account_id
      WHERE t.run_id=? AND t.excluded=0 AND b.status='sent' AND b.track_links=1
      AND EXISTS(SELECT 1 FROM broadcast_tracked_links l WHERE l.broadcast_id=b.id) ORDER BY t.line_account_id`).bind(run.tenant_id,run.id).all<{line_account_id:string}>()).results.map(r=>r.line_account_id);
    if(!accountIds.length)throw new StampError('送信済みでリンクの計測がある配信だけ追送できます',409);
  }
  const body:HqBroadcastInput={...source,requestId:input.requestId,title:typeof input.title==='string'?input.title:`${source.title}（${followup?'追送':'複製'}）`,scheduledAt:null,saveAsDraft:true,
    ...(followup?{...(source.afterActionVersionIds?{afterActionVersionIds:Object.fromEntries(Object.entries(source.afterActionVersionIds).filter(([id])=>accountIds.includes(id)))}:{}),accountIds,accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},targetType:'segment',segmentConditions:null,savedSearchId:null,excludedTagIds:[],targetTagId:null,followupOfRunId:run.id}:{}),};
  const counts=[];
  if(followup)for(const accountId of accountIds)counts.push({accountId,count:(await countHqAudience(db,accountId,await resolveHqBroadcastAudience(db,run.tenant_id,accountId,body))).count});
  const created=await prepareHqBroadcast(db,run.tenant_id,actorId,body);
  return {...await readHqBroadcastResult(db,created),...(followup?{followupAudience:counts,followupAudienceCount:counts.reduce((n,r)=>n+r.count,0)}:{}),sent:0};
}
