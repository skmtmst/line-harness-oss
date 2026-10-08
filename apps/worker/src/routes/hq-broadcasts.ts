import { sensitiveStepUpSatisfied, stepUpRequiredResponse } from '../lib/step-up.js';
import { hqBroadcastApprovalState, hqBroadcastApprovalCandidates, updateHqApproval } from '../services/hq-broadcast-approval.js';
import { hqBroadcastRecipients, hqBroadcastActivity, testHqBroadcast } from '../services/hq-broadcast-details.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { isFolderSelectColor } from '@line-crm/shared';
import type { HqBroadcastInput, HqBroadcastDraftInput } from '@line-crm/shared';
import { dbFor } from '../services/db-router.js';
import { requireRole, requireIrreversibleConfirmation } from '../middleware/role-guard.js';
import { StampError } from '../services/visit-stamps.js';
import { hqBroadcastAuthority, prepareHqBroadcast, getHqBroadcastRun, readHqBroadcastResult, preflightHqBroadcast,
  excludeHqBroadcastTargets, dispatchHqBroadcast, stopHqBroadcast, retryHqBroadcastTarget } from '../services/hq-broadcasts.js';
export const hqBroadcasts=new Hono<Env>();
hqBroadcasts.onError((e,c)=>c.json({success:false,error:e instanceof StampError?e.message:'統括配信を確認できません'},e instanceof StampError?e.status:500));
hqBroadcasts.use('/api/hq/broadcasts/*',requireRole('owner','admin'),async(c,next)=>{await hqBroadcastAuthority(dbFor(c.env),c.get('staff'),['GET','HEAD'].includes(c.req.method));await next();});
hqBroadcasts.get('/api/hq/broadcasts',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method));
  const ids=(await db.prepare('SELECT id FROM hq_broadcast_runs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').bind(a.tenantId).all<{id:string}>()).results;
  const data=[];for(const r of ids)data.push(await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,r.id)));
  return c.json({success:true,data});
});
hqBroadcasts.post('/api/hq/broadcasts',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),input=await c.req.json<HqBroadcastInput>();
  const run=await prepareHqBroadcast(db,a.tenantId,a.actorId,input);return c.json({success:true,data:await readHqBroadcastResult(db,run)},201);
});
hqBroadcasts.get('/api/hq/broadcasts/approvals/candidates',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),true);
 return c.json({success:true,data:(await hqBroadcastApprovalCandidates(db,a.tenantId)).filter(r=>r.id!==a.actorId).map(r=>({...r,canApprove:true}))});
});
hqBroadcasts.get('/api/hq/broadcasts/folders',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),true);
 return c.json({success:true,data:(await db.prepare(`SELECT f.id,f.name,f.revision,f.color,
   (SELECT COUNT(*) FROM hq_broadcast_runs r WHERE r.tenant_id=f.tenant_id AND json_extract(r.input_json,'$.folderId')=f.id) AS item_count
   FROM hq_broadcast_folders f WHERE tenant_id=? AND archived_at IS NULL ORDER BY name,id`).bind(a.tenantId).all()).results});
});
hqBroadcasts.post('/api/hq/broadcasts/folders',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{name:string;color?:string|null}>();
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)throw new StampError('分類名を確認してください');
 if(b.color!==undefined&&!isFolderSelectColor(b.color))return c.json({success:false,error:'フォルダの色を確認してください'},422);
 const id=crypto.randomUUID();await db.prepare('INSERT INTO hq_broadcast_folders(id,tenant_id,name,color) VALUES(?,?,?,?)').bind(id,a.tenantId,b.name.trim(),b.color??null).run();
 return c.json({success:true,data:{id,name:b.name.trim(),color:b.color??null,revision:1}},201);
});
hqBroadcasts.patch('/api/hq/broadcasts/folders/:id',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{name:string;expectedVersion:number;color?:string|null}>();
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||!Number.isSafeInteger(b.expectedVersion))throw new StampError('分類名と版を確認してください');
 if(b.color!==undefined&&!isFolderSelectColor(b.color))return c.json({success:false,error:'フォルダの色を確認してください'},422);
 const r=await db.prepare(`UPDATE hq_broadcast_folders SET name=?,color=CASE WHEN ? THEN ? ELSE color END,revision=revision+1,updated_at=datetime('now') WHERE id=? AND tenant_id=? AND revision=? AND archived_at IS NULL`)
 .bind(b.name.trim(),b.color!==undefined?1:0,b.color??null,c.req.param('id'),a.tenantId,b.expectedVersion).run();if(!r.meta.changes)throw new StampError('分類が更新されました',409);
 const folder=await db.prepare('SELECT id,name,revision,color FROM hq_broadcast_folders WHERE id=? AND tenant_id=?').bind(c.req.param('id'),a.tenantId).first();
 return c.json({success:true,data:folder});
});
hqBroadcasts.delete('/api/hq/broadcasts/folders/:id',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{expectedVersion:number}>();
 if(!Number.isSafeInteger(b.expectedVersion))throw new StampError('版を確認してください');
 const r=await db.prepare(`UPDATE hq_broadcast_folders SET archived_at=datetime('now'),revision=revision+1 WHERE id=? AND tenant_id=? AND revision=? AND archived_at IS NULL`)
 .bind(c.req.param('id'),a.tenantId,b.expectedVersion).run();if(!r.meta.changes)throw new StampError('分類が更新されました',409);
 return c.json({success:true,data:{id:c.req.param('id'),archived:true}});
});
hqBroadcasts.get('/api/hq/broadcasts/:id',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method));return c.json({success:true,data:await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')))});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/preflight',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method));return c.json({success:true,data:await preflightHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')))});
});
hqBroadcasts.put('/api/hq/broadcasts/:id/exclusions',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),b=await c.req.json<{accountIds:string[];expectedVersion:number}>();
  const run=await getHqBroadcastRun(db,a.tenantId,c.req.param('id'));await excludeHqBroadcastTargets(db,run,a.actorId,b.accountIds,b.expectedVersion);
  return c.json({success:true,data:await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,run.id))});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/send',requireIrreversibleConfirmation('broadcast-send'),async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),b=await c.req.json<{expectedVersion:number;confirmedRecipientCount?:number}>();
  if(!Number.isSafeInteger(b.expectedVersion))throw new StampError('版を確認してください');
  return c.json({success:true,data:await dispatchHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,b.expectedVersion,b.confirmedRecipientCount)});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/stop',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),b=await c.req.json<{expectedVersion:number}>();
  return c.json({success:true,data:await stopHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,false,b.expectedVersion)});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/cancel',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),b=await c.req.json<{expectedVersion:number}>();
  return c.json({success:true,data:await stopHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,true,b.expectedVersion)});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/targets/:accountId/retry',requireIrreversibleConfirmation('broadcast-send'),async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),b=await c.req.json<{expectedVersion:number}>();
  return c.json({success:true,data:await retryHqBroadcastTarget(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),c.req.param('accountId'),a.actorId,b.expectedVersion)});
});

hqBroadcasts.patch('/api/hq/broadcasts/:id',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),['GET','HEAD'].includes(c.req.method)),b=await c.req.json<HqBroadcastDraftInput>().catch(()=>null);
 if(!b||typeof b!=='object'||Array.isArray(b))throw new StampError('入力を確認してください');
 const {expectedVersion,...input}=b,run=await getHqBroadcastRun(db,a.tenantId,c.req.param('id'));
 return c.json({success:true,data:await readHqBroadcastResult(db,await prepareHqBroadcast(db,a.tenantId,a.actorId,input,{run,expectedVersion}))});
});

function pagination(c:{req:{query(k:string):string|undefined}}) {
 const offset=Number(c.req.query('cursor')??0),limit=Number(c.req.query('limit')??50);
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new StampError('件数を確認してください');
 return {offset,limit};
}
hqBroadcasts.get('/api/hq/broadcasts/:id/approval',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),true);
 return c.json({success:true,data:await hqBroadcastApprovalState(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId)});
});
for(const [suffix,action] of [['approval-request','request'],['approve','approve'],['reject','reject'],['approval-cancel','cancel']] as const)
 hqBroadcasts.post(`/api/hq/broadcasts/:id/${suffix}`,async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'));
 if(action==='approve'){const state=await hqBroadcastApprovalState(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId);
   if(!state.viewer.canApprove)throw new StampError('承認を頼まれた別の担当者だけ決められます',403);
   if(!await sensitiveStepUpSatisfied(c,'broadcast.approval'))return stepUpRequiredResponse(c,'配信の承認には本人確認が必要です');}
 return c.json({success:true,data:await updateHqApproval(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,action,await c.req.json())});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/test-send',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{accountId:string}>();
 return c.json({success:true,data:await testHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,b.accountId)});
});
hqBroadcasts.get('/api/hq/broadcasts/:id/targets/:accountId/recipients',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),true),p=pagination(c);
 return c.json({success:true,data:await hqBroadcastRecipients(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),c.req.param('accountId'),p.offset,p.limit)});
});
hqBroadcasts.get('/api/hq/broadcasts/:id/activity',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),true),p=pagination(c);
 return c.json({success:true,data:await hqBroadcastActivity(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),p.offset,p.limit)});
});
hqBroadcasts.get('/api/hq/broadcasts/:id/export.csv',async c=>{
 const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'),true),run=await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')));
 const cell=(v:unknown)=>{let s=v==null?'':String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
 const lines=[['アカウント','状態','送った数','開いた数','押した数','反応した人数'],...run.targets.map(t=>[t.accountName,t.status,t.successCount,t.openedCount,t.clickedCount,t.reactionCount])];
 return new Response('\uFEFF'+lines.map(r=>r.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="hq-broadcast.csv"','Cache-Control':'no-store'}});
});
