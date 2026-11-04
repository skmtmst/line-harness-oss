import {addDays,jstDate} from '@line-crm/shared';
import { inboxResponseAnalytics, inboxResponsePeriod } from '../services/inbox-response-analytics.js';
import { createInboxAssignmentRun, getInboxAssignmentRun } from '../services/inbox-assignment-runs.js';
import { routingSettings,routingInput } from '../services/inbox-assignment.js';
import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {gapAccount,gapBody,gapVersion,gapWrite,gapKey,GapError} from '../services/gap-common.js';
import {inboxSlaSettings} from '../services/inbox-sla.js';
export const inboxSla=new Hono<Env>();
inboxSla.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'inbox_sla_unavailable'},e instanceof GapError?e.status:503));
inboxSla.get('/api/inbox/routing-settings',async c=>{const a=await gapAccount(c);
 const count=await c.env.DB.prepare(`SELECT COUNT(*) n FROM chats c JOIN friends f ON f.id=c.friend_id
 WHERE f.line_account_id=? AND c.operator_id IS NULL AND c.assignee_staff_id IS NULL AND c.status!='resolved'`).bind(a).first<{n:number}>();
 return c.json({success:true,data:{...await inboxSlaSettings(c.env.DB,a),...await routingSettings(c.env.DB,a),unassignedCount:count?.n??0}});});
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
 gapWrite(c,{admin:true,impersonation:true});const account=await gapAccount(c), key=gapKey(c), staff=c.get('staff');
 const data=await createInboxAssignmentRun(c.env.DB,account,staff.id,staff.tenantId,key);
 return c.json({success:true,data},202);
});
inboxSla.get('/api/inbox/routing/apply-unassigned/:id',async c=>{
 const account=await gapAccount(c),staff=c.get('staff');
 if(!['owner','admin'].includes(staff.role)||staff.readOnly)throw new GapError('forbidden',403);
 return c.json({success:true,data:await getInboxAssignmentRun(c.env.DB,account,staff.tenantId,c.req.param('id'))});
});
inboxSla.get('/api/analytics/inbox-response',async c=>{
 const account=await gapAccount(c),staff=c.get('staff');
 const today=jstDate(),day=new Date(`${today}T00:00:00Z`).getUTCDay();
 const end=c.req.query('to')??addDays(today,(7-day)%7);
 const endAt=Date.parse(`${end}T00:00:00Z`);
 const from=c.req.query('from')??(Number.isFinite(endAt)?addDays(end,-27):end);
 const own=staff.readOnly||!['owner','admin'].includes(staff.role)?staff.id:null;
 return c.json({success:true,data:await inboxResponseAnalytics(c.env.DB,account,from,end,own)});
});
inboxSla.get('/api/analytics/inbox-response/conversations',async c=>{
 const account=await gapAccount(c),staff=c.get('staff');
 if(staff.role==='staff' && ![...(staff.permissionKeys??[]),...(staff.viewPermissionKeys??[])].includes('/chats'))throw new GapError('forbidden',403);
 const target=c.req.query('staffId'),deleted=c.req.query('staffDeleted')==='1',automatic=c.req.query('kind')==='automatic';
 if(target===undefined)throw new GapError('staff_required');
 const own=staff.readOnly||!['owner','admin'].includes(staff.role)?staff.id:null;
 if(own!==null && (target!==own || deleted || automatic))throw new GapError('forbidden',403);
 const from=c.req.query('from')??'',to=c.req.query('to')??'',{start,end}=inboxResponsePeriod(from,to);
 const offset=Number(c.req.query('offset')??0);
 if(!Number.isSafeInteger(offset)||offset<0)throw new GapError('invalid_offset');
 const results=await c.env.DB.prepare(`SELECT s.id AS sampleId,s.responded_at AS respondedAt,c.id AS chatId,f.id AS friendId,f.display_name AS friendName
  FROM inbox_response_samples s JOIN chats c ON c.id=s.chat_id JOIN friends f ON f.id=c.friend_id
  WHERE s.account_id=? AND f.line_account_id=? AND s.reply_kind=? AND (?=1 OR s.is_first_response=1)
   AND s.responded_at>=? AND s.responded_at<?
   AND s.staff_id IS ? AND s.staff_deleted=?
  ORDER BY s.responded_at DESC,s.id DESC LIMIT 51 OFFSET ?`)
  .bind(account,account,automatic?'automatic':'manual',automatic?1:0,start,end,target||null,deleted?1:0,offset).all<{sampleId:string;respondedAt:string;chatId:string;friendId:string;friendName:string|null}>();
 return c.json({success:true,data:{items:results.results.slice(0,50),hasMore:results.results.length>50}});
});
inboxSla.put('/api/me/presence',async c=>{
 gapWrite(c);const b=await gapBody(c);if(typeof b.away!=='boolean')throw new GapError('invalid_presence');
 await c.env.DB.prepare('INSERT INTO staff_presence(staff_id,away,last_seen_at) VALUES(?,?,?) ON CONFLICT(staff_id) DO UPDATE SET away=excluded.away,last_seen_at=excluded.last_seen_at').bind(c.get('staff').id,b.away?1:0,new Date().toISOString()).run();return c.json({success:true,data:{away:b.away}});
});
