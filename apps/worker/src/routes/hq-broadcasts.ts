import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { HqBroadcastInput } from '@line-crm/shared';
import { dbFor } from '../services/db-router.js';
import { requireRole, requireIrreversibleConfirmation } from '../middleware/role-guard.js';
import { StampError } from '../services/visit-stamps.js';
import { hqBroadcastAuthority, prepareHqBroadcast, getHqBroadcastRun, readHqBroadcastResult, preflightHqBroadcast,
  excludeHqBroadcastTargets, dispatchHqBroadcast, stopHqBroadcast, retryHqBroadcastTarget } from '../services/hq-broadcasts.js';
export const hqBroadcasts=new Hono<Env>();
hqBroadcasts.onError((e,c)=>c.json({success:false,error:e instanceof StampError?e.message:'統括配信を確認できません'},e instanceof StampError?e.status:500));
hqBroadcasts.use('/api/hq/broadcasts/*',requireRole('owner','admin'),async(c,next)=>{await hqBroadcastAuthority(dbFor(c.env),c.get('staff'));await next();});
hqBroadcasts.get('/api/hq/broadcasts',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'));
  const ids=(await db.prepare('SELECT id FROM hq_broadcast_runs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').bind(a.tenantId).all<{id:string}>()).results;
  const data=[];for(const r of ids)data.push(await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,r.id)));
  return c.json({success:true,data});
});
hqBroadcasts.post('/api/hq/broadcasts',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),input=await c.req.json<HqBroadcastInput>();
  const run=await prepareHqBroadcast(db,a.tenantId,a.actorId,input);return c.json({success:true,data:await readHqBroadcastResult(db,run)},201);
});
hqBroadcasts.get('/api/hq/broadcasts/:id',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'));return c.json({success:true,data:await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')))});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/preflight',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff'));return c.json({success:true,data:await preflightHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')))});
});
hqBroadcasts.put('/api/hq/broadcasts/:id/exclusions',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{accountIds:string[];expectedVersion:number}>();
  const run=await getHqBroadcastRun(db,a.tenantId,c.req.param('id'));await excludeHqBroadcastTargets(db,run,a.actorId,b.accountIds,b.expectedVersion);
  return c.json({success:true,data:await readHqBroadcastResult(db,await getHqBroadcastRun(db,a.tenantId,run.id))});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/send',requireIrreversibleConfirmation('broadcast-send'),async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{expectedVersion:number}>();
  if(!Number.isSafeInteger(b.expectedVersion))throw new StampError('版を確認してください');
  return c.json({success:true,data:await dispatchHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,b.expectedVersion)});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/stop',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{expectedVersion:number}>();
  return c.json({success:true,data:await stopHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,false,b.expectedVersion)});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/cancel',async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{expectedVersion:number}>();
  return c.json({success:true,data:await stopHqBroadcast(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),a.actorId,true,b.expectedVersion)});
});
hqBroadcasts.post('/api/hq/broadcasts/:id/targets/:accountId/retry',requireIrreversibleConfirmation('broadcast-send'),async c=>{
  const db=dbFor(c.env),a=await hqBroadcastAuthority(db,c.get('staff')),b=await c.req.json<{expectedVersion:number}>();
  return c.json({success:true,data:await retryHqBroadcastTarget(db,await getHqBroadcastRun(db,a.tenantId,c.req.param('id')),c.req.param('accountId'),a.actorId,b.expectedVersion)});
});
