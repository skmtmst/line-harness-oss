import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import type { VisitStampCardInput, VisitStampPaperInput } from '@line-crm/shared';
import { dbFor } from '../services/db-router.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { getStaffById } from '@line-crm/db';
import { StampError, stampId, stampCard, readStampCard, saveStampCard, stampWallet, stampEntries, grantStamps, reverseStampEntry,
  setStampPin, offerStampReward, useStampReward, requestPaperStamps, applyPaperStamps, getStampVisit, reconcileStampVisit } from '../services/visit-stamps.js';

export const visitStamps=new Hono<Env>();
visitStamps.onError((e,c)=>c.json({success:false,error:e instanceof StampError?e.message:'スタンプの処理を確認できません'},e instanceof StampError?e.status:500));
const tenant=(c:Context<Env>)=>{const t=c.get('staff')?.tenantId;if(!t)throw new StampError('ログインが必要です',401);return t;};
async function account(c:Context<Env>,id:unknown) {
  const a=stampId(id);const db=dbFor(c.env),row=await db.prepare('SELECT tenant_id FROM line_accounts WHERE id=?').bind(a).first<{tenant_id:string}>();
  if(!row||row.tenant_id!==tenant(c)||!(await getVisibleLineAccountScope(db,c.get('staff'))).ids.includes(a))throw new StampError('この店舗の権限がありません',403);return a;
}
async function body(c:Context<Env>):Promise<Record<string,unknown>> {
  const input=await c.req.json().catch(()=>null);if(!input||typeof input!=='object'||Array.isArray(input))throw new StampError('入力を確認してください');return input;
}
visitStamps.use('/api/visit-stamps/*',requireRole('owner','admin','staff'));
visitStamps.use('/api/visit-stamps/*',async(c,next)=>{tenant(c);if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){if(c.get('staff')?.readOnly)throw new StampError('閲覧のみの権限です',403);}await next();});
visitStamps.get('/api/visit-stamps/cards',async c=>{
  const scope=await getVisibleLineAccountScope(dbFor(c.env),c.get('staff'));
  if(!scope.ids.length)return c.json({success:true,data:[]});
  const rows=(await dbFor(c.env).prepare(`SELECT DISTINCT c.id FROM visit_stamp_cards c JOIN visit_stamp_card_accounts a ON a.card_id=c.id
    WHERE c.tenant_id=? AND a.line_account_id IN (${scope.ids.map(()=>'?').join(',')})`).bind(tenant(c),...scope.ids).all<{id:string}>()).results;
  const data=[];for(const r of rows)data.push(await readStampCard(dbFor(c.env),await stampCard(dbFor(c.env),r.id,tenant(c))));
  return c.json({success:true,data});
});
visitStamps.post('/api/visit-stamps/cards',requireRole('owner','admin'),async c=>{
  const input=await body(c) as unknown as VisitStampCardInput;
  if(!Array.isArray(input.accountIds))throw new StampError('押せる店舗を選んでください');for(const a of input.accountIds)await account(c,a);
  return c.json({success:true,data:await saveStampCard(dbFor(c.env),tenant(c),input)},201);
});
visitStamps.put('/api/visit-stamps/cards/:id',requireRole('owner','admin'),async c=>{
  const db=dbFor(c.env),old=await readStampCard(db,await stampCard(db,c.req.param('id'),tenant(c))),input=await body(c) as unknown as VisitStampCardInput;
  if(!Array.isArray(input.accountIds))throw new StampError('押せる店舗を選んでください');for(const a of [...old.accountIds,...input.accountIds])await account(c,a);
  return c.json({success:true,data:await saveStampCard(db,tenant(c),input,c.req.param('id'))});
});
visitStamps.get('/api/visit-stamps/cards/:id/wallet',async c=>{
  const a=await account(c,c.req.query('accountId')),db=dbFor(c.env);await stampCard(db,c.req.param('id'),tenant(c));const friend=stampId(c.req.query('friendId'));
  const wallet=await stampWallet(db,c.req.param('id'),friend,a);return c.json({success:true,data:{wallet,entries:await stampEntries(db,c.req.param('id'),wallet.friendId)}});
});
visitStamps.post('/api/visit-stamps/cards/:id/grants',requireRole('owner','admin','staff'),async c=>{
  const b=await body(c),a=await account(c,b.accountId),db=dbFor(c.env);await stampCard(db,c.req.param('id'),tenant(c));
  return c.json({success:true,data:await grantStamps(db,{cardId:c.req.param('id'),friendId:stampId(b.friendId),accountId:a,count:b.count as number,reason:b.reason as string,actorId:c.get('staff')!.id,requestId:stampId(b.requestId),kind:b.source==='paper'?'paper':'manual'})});
});
visitStamps.post('/api/visit-stamps/entries/:id/reverse',requireRole('owner','admin'),async c=>{
  const b=await body(c),db=dbFor(c.env),entry=await db.prepare('SELECT line_account_id FROM visit_stamp_entries WHERE id=?').bind(c.req.param('id')).first<{line_account_id:string}>();
  if(!entry)throw new StampError('記録が見つかりません',404);await account(c,entry.line_account_id);
  return c.json({success:true,data:await reverseStampEntry(db,c.req.param('id'),tenant(c),c.get('staff')!.id,b.reason as string)});
});
visitStamps.put('/api/visit-stamps/pins/:staffId',requireRole('owner','admin'),async c=>{
  const b=await body(c),a=await account(c,b.accountId),db=dbFor(c.env),member=await getStaffById(db,stampId(c.req.param('staffId')));
  if(!member||!member.is_active||member.tenant_id!==tenant(c)||member.access_level==='read_only'||!(await getVisibleLineAccountScope(db,{
    id:member.id,name:member.name,role:member.role,tenantId:member.tenant_id,readOnly:false,accountScope:member.account_scope??'all',
  } as Env['Variables']['staff'])).ids.includes(a))throw new StampError('店員の所属店舗を確認してください',403);
  await setStampPin(db,a,member.id,b.pin as string);return c.json({success:true,data:{staffId:member.id,accountId:a,configured:true}});
});
visitStamps.get('/api/visit-stamps/paper-requests',async c=>{
  const a=await account(c,c.req.query('accountId'));
  return c.json({success:true,data:(await dbFor(c.env).prepare('SELECT * FROM visit_stamp_paper_requests WHERE line_account_id=? ORDER BY created_at DESC LIMIT 200').bind(a).all()).results});
});
visitStamps.post('/api/visit-stamps/paper-requests/:id/review',requireRole('owner','admin','staff'),async c=>{
  const b=await body(c),db=dbFor(c.env),r=await db.prepare('SELECT line_account_id FROM visit_stamp_paper_requests WHERE id=?').bind(c.req.param('id')).first<{line_account_id:string}>();
  if(!r)throw new StampError('申請が見つかりません',404);await account(c,r.line_account_id);
  if(!['approve','reject'].includes(b.action as string))throw new StampError('承認か却下を選んでください');
  return c.json({success:true,data:await applyPaperStamps(db,c.req.param('id'),tenant(c),c.get('staff')!.id,b.action==='approve',b.reason as string)});
});
visitStamps.post('/api/visit-stamps/visits/:kind/:id/checkout',requireRole('owner','admin','staff'),async c=>{
  const b=await body(c),kind=c.req.param('kind') as 'restaurant'|'booking',db=dbFor(c.env),visit=await getStampVisit(db,kind,c.req.param('id'));
  if(!visit)throw new StampError('来店が見つかりません',404);await account(c,visit.account_id);if(!visit.visited)throw new StampError('来店済みの記録だけ会計できます',409);
  if(!Number.isSafeInteger(b.amount)||(b.amount as number)<0||(b.amount as number)>100000000)throw new StampError('会計金額を確認してください');
  const saved=await db.prepare('INSERT OR IGNORE INTO visit_stamp_checkouts(kind,visit_id,line_account_id,amount,recorded_by) VALUES(?,?,?,?,?)').bind(kind,visit.id,visit.account_id,b.amount,c.get('staff')!.id).run();
  const prior=await db.prepare('SELECT amount FROM visit_stamp_checkouts WHERE kind=? AND visit_id=?').bind(kind,visit.id).first<{amount:number}>();
  if(prior!.amount!==b.amount)throw new StampError('会計済みです。押印の取消後に手動で訂正してください',409);
  await reconcileStampVisit(db,kind,visit.id);return c.json({success:true,data:{visitId:visit.id,amount:b.amount,recorded:true}});
});
// LIFFはIDトークンの対象チャンネルを指定店舗のlogin_channel_idに固定する。
async function customer(c:Context<Env>) {
  const a=stampId(c.req.query('accountId')),db=dbFor(c.env);
  const shop=await db.prepare('SELECT id,tenant_id,login_channel_id FROM line_accounts WHERE id=? AND is_active=1 AND archived_at IS NULL').bind(a).first<{tenant_id:string;login_channel_id:string|null}>();
  const token=c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token||!shop?.login_channel_id)throw new StampError('LINEの本人確認が必要です',401);
  const response=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({id_token:token,client_id:shop.login_channel_id}),signal:AbortSignal.timeout(10000)});
  const identity=response.ok?await response.json() as {sub?:string}:null;
  if(!identity?.sub)throw new StampError('LINEの本人確認が必要です',401);
  const friend=await db.prepare('SELECT id FROM friends WHERE line_account_id=? AND line_user_id=? AND is_following=1').bind(a,identity.sub).first<{id:string}>();
  if(!friend)throw new StampError('友だちの確認が必要です',403);return {db,a,friendId:friend.id,tenantId:shop.tenant_id};
}
visitStamps.get('/api/liff/visit-stamps/cards',async c=>{
  const x=await customer(c),rows=(await x.db.prepare('SELECT card_id FROM visit_stamp_card_accounts WHERE line_account_id=?').bind(x.a).all<{card_id:string}>()).results;
  const data=[];for(const r of rows){const card=await stampCard(x.db,r.card_id,x.tenantId);if(card.active)data.push({card:await readStampCard(x.db,card),wallet:await stampWallet(x.db,r.card_id,x.friendId,x.a)});}
  return c.json({success:true,data});
});
visitStamps.get('/api/liff/visit-stamps/cards/:id',async c=>{
  const x=await customer(c),card=await stampCard(x.db,c.req.param('id'),x.tenantId),wallet=await stampWallet(x.db,card.id,x.friendId,x.a);
  return c.json({success:true,data:{card:await readStampCard(x.db,card),wallet,entries:await stampEntries(x.db,card.id,wallet.friendId)}});
});
visitStamps.post('/api/liff/visit-stamps/cards/:id/rewards',async c=>{
  const x=await customer(c),b=await body(c);await stampCard(x.db,c.req.param('id'),x.tenantId);
  return c.json({success:true,data:await offerStampReward(x.db,c.req.param('id'),x.friendId,x.a,stampId(b.rewardId),stampId(b.requestId))},201);
});
visitStamps.post('/api/liff/visit-stamps/redemptions/:id/use',async c=>{
  const x=await customer(c),b=await body(c),staffId=stampId(b.staffId),member=await getStaffById(x.db,staffId);
  if(!member||!member.is_active||member.tenant_id!==x.tenantId||member.access_level==='read_only')throw new StampError('店員を確認してください',403);
  if(!(await getVisibleLineAccountScope(x.db,{id:member.id,name:member.name,role:member.role,tenantId:x.tenantId,readOnly:false} as Env['Variables']['staff'])).ids.includes(x.a))throw new StampError('店員の店舗を確認してください',403);
  return c.json({success:true,data:await useStampReward(x.db,c.req.param('id'),x.friendId,x.a,staffId,b.pin as string)});
});
visitStamps.post('/api/liff/visit-stamps/cards/:id/paper-requests',async c=>{
  const x=await customer(c),b=await body(c) as unknown as VisitStampPaperInput;await stampCard(x.db,c.req.param('id'),x.tenantId);
  return c.json({success:true,data:await requestPaperStamps(x.db,c.req.param('id'),x.friendId,x.a,b.photoUrl,b.stamps)},201);
});
