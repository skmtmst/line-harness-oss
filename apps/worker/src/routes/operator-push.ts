import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {GapError,gapBody,gapKey,gapVersion} from '../services/gap-common.js';
import {validPushEndpoint,unbase64} from '../services/web-push.js';
import {deliverOperatorPush} from '../services/operator-push.js';
export const operatorPush=new Hono<Env>();
operatorPush.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'push_unavailable'},e instanceof GapError?e.status:503));
operatorPush.use('/api/me/push/*',async(c,next)=>{if(!c.get('staff'))throw new GapError('unauthorized',401);if(c.get('impersonation')&&!['GET','HEAD'].includes(c.req.method))throw new GapError('IMPERSONATION_WRITE_BLOCKED',403);await next();});
operatorPush.get('/api/me/push',async(c)=>{
 const id=c.get('staff').id,subscriptions=(await c.env.DB.prepare('SELECT id,user_agent_label,created_at,last_success_at,last_error_code,revoked_at FROM operator_push_subscriptions WHERE staff_id=? ORDER BY created_at DESC').bind(id).all()).results;
 const prefs=await c.env.DB.prepare('SELECT * FROM operator_push_preferences WHERE staff_id=?').bind(id).first();
 return c.json({success:true,data:{subscriptions,preferences:prefs??{staff_id:id,kinds_json:'["new_inquiry","assigned_reply"]',quiet_start:'22:00',quiet_end:'08:00',quiet_allow_critical:0,version:0},vapidPublicKey:c.env.OPERATOR_PUSH_VAPID_PUBLIC_KEY??null,configured:!!(c.env.OPERATOR_PUSH_VAPID_PRIVATE_KEY&&c.env.OPERATOR_PUSH_VAPID_PUBLIC_KEY)}});
});
operatorPush.post('/api/me/push/subscriptions',async(c)=>{
 gapKey(c);const b=await gapBody(c),id=c.get('staff').id,keys=b.keys as {p256dh?:unknown;auth?:unknown};
 if(!validPushEndpoint(b.endpoint)||!keys||typeof keys.p256dh!=='string'||typeof keys.auth!=='string'||typeof b.label!=='string'||!b.label.trim()||b.label.length>100)throw new GapError('invalid_subscription');
 try{if(unbase64(keys.p256dh).length!==65||unbase64(keys.auth).length!==16)throw 0;await crypto.subtle.importKey('raw',unbase64(keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw new GapError('invalid_subscription_keys');}
 const r=await c.env.DB.prepare(`INSERT INTO operator_push_subscriptions(id,staff_id,endpoint,p256dh,auth,user_agent_label,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,user_agent_label=excluded.user_agent_label,revoked_at=NULL WHERE staff_id=excluded.staff_id`).bind(crypto.randomUUID(),id,b.endpoint,keys.p256dh,keys.auth,b.label.trim(),new Date().toISOString()).run();if(!r.meta.changes)throw new GapError('subscription_unavailable',409);
 const row=await c.env.DB.prepare('SELECT id,user_agent_label FROM operator_push_subscriptions WHERE staff_id=? AND endpoint=?').bind(id,b.endpoint).first();return c.json({success:true,data:row},201);
});
operatorPush.delete('/api/me/push/subscriptions/:id',async(c)=>{
 const staff=c.get('staff'),row=await c.env.DB.prepare('SELECT s.staff_id,m.tenant_id FROM operator_push_subscriptions s JOIN staff_members m ON m.id=s.staff_id WHERE s.id=?').bind(c.req.param('id')).first<{staff_id:string;tenant_id:string}>();if(!row||row.staff_id!==staff.id&&(!['owner','admin'].includes(staff.role)||staff.readOnly||!staff.tenantId||staff.tenantId!==row.tenant_id))throw new GapError('not_found',404);
 await c.env.DB.prepare('UPDATE operator_push_subscriptions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),c.req.param('id')).run();return c.json({success:true});
});
operatorPush.put('/api/me/push/preferences',async(c)=>{
 const b=await gapBody(c),v=gapVersion(b.expectedVersion);if(!Array.isArray(b.kinds)||b.kinds.some(x=>!['new_inquiry','assigned_reply'].includes(String(x)))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.quietStart))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.quietEnd))||typeof b.quietAllowCritical!=='boolean')throw new GapError('invalid_push_preferences');
 const id=c.get('staff').id,r=await c.env.DB.prepare(`INSERT INTO operator_push_preferences(staff_id,kinds_json,quiet_start,quiet_end,quiet_allow_critical) SELECT ?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM operator_push_preferences WHERE staff_id=? AND version=?) ON CONFLICT(staff_id) DO UPDATE SET kinds_json=excluded.kinds_json,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,quiet_allow_critical=excluded.quiet_allow_critical,version=version+1 WHERE version=?`).bind(id,JSON.stringify([...new Set(b.kinds)]),b.quietStart,b.quietEnd,b.quietAllowCritical?1:0,v,id,v,v).run();if(!r.meta.changes)throw new GapError('version_conflict',409);return c.json({success:true,data:{version:v+1}});
});
operatorPush.post('/api/me/push/test',async(c)=>{
 const id=c.get('staff').id,minute=Math.floor(Date.now()/60000),recent=await c.env.DB.prepare("SELECT 1 FROM operator_push_deliveries d JOIN operator_push_subscriptions s ON s.id=d.subscription_id WHERE s.staff_id=? AND d.kind='test' AND julianday(d.created_at)>julianday('now')-1.0/1440").bind(id).first();if(recent)throw new GapError('push_test_rate_limit',409);
 if(!c.env.OPERATOR_PUSH_VAPID_PRIVATE_KEY||!c.env.OPERATOR_PUSH_VAPID_PUBLIC_KEY||!c.env.OPERATOR_PUSH_VAPID_SUBJECT)throw new GapError('vapid_not_configured',503);
 const result=await deliverOperatorPush(c.env.DB,c.env,{staffId:id,account:'',kind:'test',refId:`test:${minute}`,chatId:''});return c.json({success:true,data:result});
});
