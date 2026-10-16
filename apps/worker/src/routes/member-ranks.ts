import {resolveAccountIdFromLiff,verifyCallerLineUserId,resolveFriendId} from './booking.js';
import {requirePermission} from '../middleware/role-guard.js';
import {Hono} from 'hono';
import type {Env} from '../index.js';
import {GapError,gapAccount,gapBody,gapVersion,gapWrite,gapKey} from '../services/gap-common.js';
import {rankProgram,rankPreview,rankEvaluationStatements,type RankTier} from '../services/member-ranks.js';
import {assertChanged,clearAssertions} from '../services/booking-series.js';
export const memberRanks=new Hono<Env>();
memberRanks.use('/api/member-ranks*',requirePermission('/mileage'));
memberRanks.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'ranks_unavailable'},e instanceof GapError?e.status:503));
memberRanks.get('/api/member-ranks/program',async c=>{const a=await gapAccount(c);return c.json({success:true,data:await rankProgram(c.env.DB,a)});});
memberRanks.put('/api/member-ranks/program',async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion);if(!['visits','amount','miles'].includes(String(b.metric))||!Number.isInteger(b.windowMonths)||Number(b.windowMonths)<1||Number(b.windowMonths)>36)throw new GapError('invalid_program');
 // Changes return the program to stopped. The owner reviews the new initial allocation before activating it.
 const r=await c.env.DB.prepare(`INSERT INTO member_rank_programs(account_id,metric,window_months,updated_at) SELECT ?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM member_rank_programs WHERE account_id=? AND version=?) ON CONFLICT(account_id) DO UPDATE SET metric=excluded.metric,window_months=excluded.window_months,status='stopped',version=version+1,updated_at=excluded.updated_at WHERE version=?`).bind(a,b.metric,b.windowMonths,new Date().toISOString(),v,a,v,v).run();if(!r.meta.changes)throw new GapError('version_conflict',409);return c.json({success:true,data:await rankProgram(c.env.DB,a)});
});
memberRanks.put('/api/member-ranks/tiers',async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion),tiers=b.tiers as RankTier[];
 if(!Array.isArray(tiers)||tiers.length<2||tiers.length>5||new Set(tiers.map(t=>t?.id)).size!==tiers.length||tiers.some((t,i)=>!t||typeof t.id!=='string'||t.id.length>100||typeof t.name!=='string'||!t.name.trim()||t.name.length>30||!Number.isSafeInteger(t.threshold)||t.threshold<0||(i===0?t.threshold!==0:t.threshold<=tiers[i-1].threshold)||typeof t.mileMultiplier!=='number'||t.mileMultiplier<1||t.mileMultiplier>3))throw new GapError('invalid_tiers');
 // Preserve retired tiers/history; IDs belonging to other stores cannot be reused.
 for(const t of tiers){const old=await c.env.DB.prepare('SELECT account_id FROM member_rank_tiers WHERE id=?').bind(t.id).first<{account_id:string}>();if(old&&old.account_id!==a)throw new GapError('invalid_tier_id');}
 const ops=[c.env.DB.prepare("UPDATE member_rank_programs SET version=version+1,status='stopped',updated_at=? WHERE account_id=? AND version=?").bind(new Date().toISOString(),a,v),assertChanged(c.env.DB),c.env.DB.prepare('UPDATE member_rank_tiers SET sort=-sort-1 WHERE account_id=? AND sort>=0').bind(a)];
 for(const [i,t]of tiers.entries()){
 const old=await c.env.DB.prepare('SELECT tag_id FROM member_rank_tiers WHERE id=? AND account_id=?').bind(t.id,a).first<{tag_id:string}>(),tag=old?.tag_id??crypto.randomUUID();
 if(!old)ops.push(c.env.DB.prepare("INSERT INTO tags(id,name,line_account_id) VALUES(?,?,?)").bind(tag,'ランク：'+t.name,a));
 else ops.push(c.env.DB.prepare('UPDATE tags SET name=? WHERE id=? AND line_account_id=?').bind('ランク：'+t.name,tag,a));
 ops.push(c.env.DB.prepare('INSERT INTO member_rank_tiers(id,account_id,sort,name,threshold,mile_multiplier,tag_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sort=excluded.sort,name=excluded.name,threshold=excluded.threshold,mile_multiplier=excluded.mile_multiplier').bind(t.id,a,i,t.name,t.threshold,t.mileMultiplier,tag));
 }
 ops.push(clearAssertions(c.env.DB));try{await c.env.DB.batch(ops);}catch(e){if(/CHECK constraint/.test(String(e)))throw new GapError('version_conflict',409);throw e;}
 return c.json({success:true,data:await rankProgram(c.env.DB,a)});
});
memberRanks.post('/api/member-ranks/preview',async c=>{const a=await gapAccount(c),p=await rankPreview(c.env.DB,a);return c.json({success:true,data:{byTier:p.byTier,wouldUpgrade:p.wouldUpgrade,wouldDowngrade:p.wouldDowngrade}});});
for(const action of ['activate','stop']as const)memberRanks.post(`/api/member-ranks/${action}`,async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion),key=action==='activate'?gapKey(c):null,request=JSON.stringify({action,expectedVersion:v});
 if(key){const old=await c.env.DB.prepare('SELECT request_json,response_json FROM member_rank_mutations WHERE account_id=? AND request_key=?').bind(a,key).first<{request_json:string;response_json:string}>();if(old){if(old.request_json!==request)throw new GapError('idempotency_conflict',409);return c.json({success:true,data:JSON.parse(old.response_json)});}}
 const program=await rankProgram(c.env.DB,a),now=new Date();
 if(program.version!==v)throw new GapError('version_conflict',409);
 const evaluations=action==='activate'?await rankEvaluationStatements(c.env.DB,a,program,true,now):[];
 const data={...program,status:action==='activate'?'active':'stopped',version:v+1,activatedAt:action==='activate'?now.toISOString():program.activatedAt};
 const ops=[c.env.DB.prepare('UPDATE member_rank_programs SET status=?,version=version+1,activated_at=? WHERE account_id=? AND version=?').bind(data.status,data.activatedAt,a,v),assertChanged(c.env.DB),...evaluations];
 if(key)ops.push(c.env.DB.prepare('INSERT INTO member_rank_mutations(account_id,request_key,request_json,response_json) VALUES(?,?,?,?)').bind(a,key,request,JSON.stringify(data)));
 ops.push(clearAssertions(c.env.DB));
 try{await c.env.DB.batch(ops);}catch(e){
  if(key){const old=await c.env.DB.prepare('SELECT request_json,response_json FROM member_rank_mutations WHERE account_id=? AND request_key=?').bind(a,key).first<{request_json:string;response_json:string}>();if(old?.request_json===request)return c.json({success:true,data:JSON.parse(old.response_json)});}
  if(/CHECK constraint|UNIQUE constraint/.test(String(e)))throw new GapError('version_conflict',409);throw e;
 }
 return c.json({success:true,data});
});
memberRanks.get('/api/friends/:id/member-rank',requirePermission('/mileage'),async c=>{
 const a=await gapAccount(c),id=c.req.param('id');if(!await c.env.DB.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(id,a).first())throw new GapError('not_found',404);
 const current=await c.env.DB.prepare('SELECT r.*,t.name,t.threshold,t.mile_multiplier FROM member_ranks r JOIN member_rank_tiers t ON t.id=r.tier_id WHERE r.account_id=? AND r.friend_id=?').bind(a,id).first();
 const history=(await c.env.DB.prepare('SELECT * FROM member_rank_history WHERE account_id=? AND friend_id=? ORDER BY at DESC LIMIT 20').bind(a,id).all()).results;
 return c.json({success:true,data:{current,history}});
});

memberRanks.get('/api/liff/member-card',async c=>{
 const a=await resolveAccountIdFromLiff(c),u=await verifyCallerLineUserId(c);if(!a||!u)throw new GapError('unauthorized',401);const f=await resolveFriendId(c,u,a);if(!f)throw new GapError('not_found',404);
 const p=await rankProgram(c.env.DB,a);const row=await c.env.DB.prepare('SELECT r.tier_id,r.since,r.downgrade_due_at,t.name,t.threshold,t.mile_multiplier FROM member_ranks r JOIN member_rank_tiers t ON t.id=r.tier_id AND t.account_id=r.account_id WHERE r.account_id=? AND r.friend_id=?').bind(a,f).first<{tier_id:string;name:string;threshold:number;downgrade_due_at:string|null;since:string}>();
 if(!row||p.status!=='active')return c.json({success:true,data:null});
 const decision=(await rankPreview(c.env.DB,a,p)).decisions.find(d=>d.id===f),next=p.tiers.find(t=>t.threshold>row.threshold);
 return c.json({success:true,data:{name:row.name,since:row.since,downgradeDueAt:row.downgrade_due_at,next:next?{name:next.name,remaining:Math.max(0,next.threshold-(decision?.score??0)),metric:p.metric}:null}});
});
