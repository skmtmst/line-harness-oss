import {requirePermission} from '../middleware/role-guard.js';
import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {GapError,gapAccount,gapBody,gapKey,gapVersion,gapWrite} from '../services/gap-common.js';
import {eventScopeInput,passPlanInput,passPlanView} from '../features/booking/booking-pass-plans/index.js';
export const bookingPassPlans=new Hono<Env>();
bookingPassPlans.use('/api/booking/admin/pass-plans*',requirePermission('/booking/bookings'));
bookingPassPlans.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'pass_plans_unavailable'},e instanceof GapError?e.status:503));
bookingPassPlans.get('/api/booking/admin/pass-plans',async c=>{
 const a=await gapAccount(c),q=c.req.query('q')??'',status=c.req.query('status')??'',offset=Number(c.req.query('offset')??0),limit=Number(c.req.query('limit')??20);if(!Number.isSafeInteger(offset)||offset<0||![10,20,50].includes(limit)||q.length>100)throw new GapError('invalid_pagination');
 const where="line_account_id=? AND (?='' OR status=?) AND instr(lower(name),lower(?))>0",binds=[a,status,status,q];
 const total=await c.env.DB.prepare(`SELECT count(*) n FROM booking_pass_plans WHERE ${where}`).bind(...binds).first<{n:number}>(),rows=(await c.env.DB.prepare(`SELECT * FROM booking_pass_plans WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).bind(...binds,limit,offset).all<Record<string,unknown>>()).results;
 const summary=await c.env.DB.prepare(`SELECT (SELECT count(*) FROM booking_pass_plans WHERE line_account_id=? AND status='on_sale') onSale,count(DISTINCT CASE WHEN status='active' THEN friend_id END) holders,count(CASE WHEN status='active' AND julianday(expires_at)>=julianday('now') AND julianday(expires_at)<=julianday('now','+30 days') THEN 1 END) expiringIn30d,count(CASE WHEN billing_status!='ok' THEN 1 END) billingFailed FROM booking_entitlements WHERE line_account_id=?`).bind(a,a).first();
 return c.json({success:true,data:{items:rows.map(passPlanView),total:total?.n??0,summary}});
});
for(const method of ['POST','PUT']as const)bookingPassPlans.on(method,method==='POST'?'/api/booking/admin/pass-plans':'/api/booking/admin/pass-plans/:id',async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),p=passPlanInput(b),actor=c.get('staff').id;
 for(const id of p.menuIds)if(!await c.env.DB.prepare('SELECT id FROM menus WHERE id=? AND line_account_id=? AND deleted_at IS NULL').bind(id,a).first())throw new GapError('invalid_menu');
 for(const id of p.eventIds??[])if(!await c.env.DB.prepare('SELECT id FROM events WHERE id=? AND line_account_id=? AND deleted_at IS NULL').bind(id,a).first())throw new GapError('invalid_event');
 const encoded=JSON.stringify(p);let id=c.req.param('id');
 if(method==='POST'){
 const key=gapKey(c);id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO booking_pass_plans(id,line_account_id,kind,name,price,count,monthly_limit,valid_days,target_scope_json,allow_without_pass,created_by,created_at,idempotency_key,request_json,event_target_scope_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id,created_by,idempotency_key) DO NOTHING`).bind(id,a,p.kind,p.name,p.price,p.count,p.monthlyLimit,p.validDays,JSON.stringify(p.menuIds),p.allowWithoutPass?1:0,actor,new Date().toISOString(),key,encoded,p.eventIds==null?null:JSON.stringify(p.eventIds)).run();
 const saved=await c.env.DB.prepare('SELECT * FROM booking_pass_plans WHERE line_account_id=? AND created_by=? AND idempotency_key=?').bind(a,actor,key).first<Record<string,unknown>>();if(saved?.request_json!==encoded)throw new GapError('idempotency_conflict',409);return c.json({success:true,data:passPlanView(saved)},201);
 }
 const v=gapVersion(b.expectedVersion),r=await c.env.DB.prepare("UPDATE booking_pass_plans SET kind=?,name=?,price=?,count=?,monthly_limit=?,valid_days=?,target_scope_json=?,allow_without_pass=?,event_target_scope_json=CASE WHEN ? THEN ? ELSE event_target_scope_json END,version=version+1 WHERE id=? AND line_account_id=? AND version=? AND status='draft'").bind(p.kind,p.name,p.price,p.count,p.monthlyLimit,p.validDays,JSON.stringify(p.menuIds),p.allowWithoutPass?1:0,p.eventIds!==undefined,p.eventIds==null?null:JSON.stringify(p.eventIds),id,a,v).run();if(!r.meta.changes)throw new GapError('version_conflict_or_not_draft',409);return c.json({success:true,data:passPlanView((await c.env.DB.prepare('SELECT * FROM booking_pass_plans WHERE id=? AND line_account_id=?').bind(id,a).first<Record<string,unknown>>())!)});
});
for(const action of ['start','stop']as const)bookingPassPlans.post(`/api/booking/admin/pass-plans/:id/${action}`,async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion);
 const eventIds=eventScopeInput(b.eventIds);
 if(action==='stop'&&eventIds!==undefined)throw new GapError('invalid_event_scope');
 for(const event of eventIds??[])if(!await c.env.DB.prepare('SELECT id FROM events WHERE id=? AND line_account_id=? AND deleted_at IS NULL').bind(event,a).first())throw new GapError('invalid_event');
 const r=await c.env.DB.prepare('UPDATE booking_pass_plans SET status=?,event_target_scope_json=CASE WHEN ? THEN ? ELSE event_target_scope_json END,version=version+1 WHERE id=? AND line_account_id=? AND version=?').bind(action==='start'?'on_sale':'stopped',eventIds!==undefined,eventIds==null?null:JSON.stringify(eventIds),c.req.param('id'),a,v).run();if(!r.meta.changes)throw new GapError('version_conflict',409);return c.json({success:true,data:{status:action==='start'?'on_sale':'stopped',version:v+1}});
});
bookingPassPlans.get('/api/booking/admin/pass-plans/:id/holders',async c=>{
 const a=await gapAccount(c),id=c.req.param('id'),offset=Number(c.req.query('offset')??0),limit=Number(c.req.query('limit')??20);if(!Number.isSafeInteger(offset)||offset<0||![10,20,50].includes(limit))throw new GapError('invalid_pagination');
 if(!await c.env.DB.prepare('SELECT id FROM booking_pass_plans WHERE id=? AND line_account_id=?').bind(id,a).first())throw new GapError('not_found',404);
 const items=(await c.env.DB.prepare('SELECT e.id,e.friend_id,f.display_name,e.remaining,e.expires_at,e.status FROM booking_entitlements e JOIN friends f ON f.id=e.friend_id AND f.line_account_id=e.line_account_id WHERE e.plan_id=? AND e.line_account_id=? ORDER BY e.expires_at,e.id LIMIT ? OFFSET ?').bind(id,a,limit,offset).all<Record<string,unknown>>()).results;
 const total=await c.env.DB.prepare('SELECT count(*) n FROM booking_entitlements WHERE plan_id=? AND line_account_id=?').bind(id,a).first<{n:number}>();return c.json({success:true,data:{items:items.map(x=>({...x,display_name:c.get('impersonation')?'（非表示）':x.display_name})),total:total?.n??0}});
});
