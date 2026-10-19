import { routingSettings,routingInput,assignInbox } from '../services/inbox-assignment.js';
import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {gapAccount,gapBody,gapVersion,gapWrite,GapError} from '../services/gap-common.js';
import {inboxSlaSettings} from '../services/inbox-sla.js';
export const inboxSla=new Hono<Env>();
inboxSla.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'inbox_sla_unavailable'},e instanceof GapError?e.status:503));
inboxSla.get('/api/inbox/routing-settings',async c=>{const a=await gapAccount(c);return c.json({success:true,data:{...await inboxSlaSettings(c.env.DB,a),...await routingSettings(c.env.DB,a)}});});
inboxSla.put('/api/inbox/routing-settings',async c=>{
 gapWrite(c,{admin:true,impersonation:true});const account=await gapAccount(c),b=await gapBody(c),v=gapVersion(b.expectedVersion);
 if(typeof b.enabled!=='boolean'||typeof b.businessHoursOnly!=='boolean'||!Number.isInteger(b.firstResponseMinutes)||Number(b.firstResponseMinutes)<5||Number(b.firstResponseMinutes)>1440)throw new GapError('invalid_sla_settings');
 const team=b.escalateTeamId??null;
 if(team!==null && (typeof team!=='string'||!await c.env.DB.prepare('SELECT id FROM operator_notification_teams WHERE id=? AND line_account_id=?').bind(team,account).first()))throw new GapError('invalid_team');
 const routing=await routingInput(c.env.DB,account,b);
 const token=crypto.randomUUID();
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO inbox_routing_settings(account_id,sla_enabled,sla_first_response_minutes,sla_business_hours_only,escalate_team_id,updated_by,updated_at,mutation_token)
   SELECT ?,?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM inbox_routing_settings WHERE account_id=? AND version=?) ON CONFLICT(account_id) DO UPDATE SET sla_enabled=excluded.sla_enabled,
   sla_first_response_minutes=excluded.sla_first_response_minutes,sla_business_hours_only=excluded.sla_business_hours_only,escalate_team_id=excluded.escalate_team_id,
   version=version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at,mutation_token=excluded.mutation_token WHERE version=?`)
   .bind(account,b.enabled?1:0,b.firstResponseMinutes,b.businessHoursOnly?1:0,team,c.get('staff').id,new Date().toISOString(),token,v,account,v,v),
  c.env.DB.prepare(`UPDATE chats SET sla_due_at=NULL WHERE friend_id IN(SELECT id FROM friends WHERE line_account_id=?) AND EXISTS(SELECT 1 FROM inbox_routing_settings WHERE account_id=? AND mutation_token=?)`).bind(account,account,token),
  c.env.DB.prepare(`INSERT INTO inbox_assignment_settings(account_id,strategy,targets_json) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM inbox_routing_settings WHERE account_id=? AND mutation_token=?) ON CONFLICT(account_id) DO UPDATE SET strategy=excluded.strategy,targets_json=excluded.targets_json`).bind(account,routing.strategy,JSON.stringify(routing.targets),account,token)
 ]);
 if(!result[0].meta.changes)throw new GapError('version_conflict',409);
 return c.json({success:true,data:{...await inboxSlaSettings(c.env.DB,account),...await routingSettings(c.env.DB,account)}});
});

inboxSla.post('/api/inbox/routing/apply-unassigned',async c=>{
 gapWrite(c,{admin:true,impersonation:true});const a=await gapAccount(c);
 const rows=(await c.env.DB.prepare("SELECT c.friend_id FROM chats c JOIN friends f ON f.id=c.friend_id WHERE f.line_account_id=? AND c.operator_id IS NULL AND c.status!='resolved' ORDER BY c.last_customer_message_at LIMIT 500").bind(a).all<{friend_id:string}>()).results;
 let assigned=0;for(const r of rows)if(await assignInbox(c.env.DB,a,r.friend_id))assigned++;
 return c.json({success:true,data:{assigned,skipped:rows.length-assigned}});
});
inboxSla.put('/api/me/presence',async c=>{
 gapWrite(c);const b=await gapBody(c);if(typeof b.away!=='boolean')throw new GapError('invalid_presence');
 await c.env.DB.prepare('INSERT INTO staff_presence(staff_id,away,last_seen_at) VALUES(?,?,?) ON CONFLICT(staff_id) DO UPDATE SET away=excluded.away,last_seen_at=excluded.last_seen_at').bind(c.get('staff').id,b.away?1:0,new Date().toISOString()).run();return c.json({success:true,data:{away:b.away}});
});
