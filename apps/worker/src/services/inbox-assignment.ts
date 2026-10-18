import {canAccessAllLineAccounts} from './account-access.js';
import {getAccountTimeZone,tzDateStr,tzHHMM} from './availability.js';
import {GapError} from './gap-common.js';
export type RoutingTarget={staffId:string;priority:number;cap:number};
export type RoutingSettings={strategy:'none'|'even'|'priority'|'random_weighted';targets:RoutingTarget[]};
export async function routingSettings(db:D1Database,a:string):Promise<RoutingSettings>{
 const r=await db.prepare('SELECT strategy,targets_json FROM inbox_assignment_settings WHERE account_id=?').bind(a).first<{strategy:RoutingSettings['strategy'];targets_json:string}>();
 return {strategy:r?.strategy??'none',targets:JSON.parse(r?.targets_json??'[]')};
}
export async function routingInput(db:D1Database,a:string,b:Record<string,unknown>):Promise<RoutingSettings>{
 const old=await routingSettings(db,a),strategy=b.strategy??old.strategy,targets=b.targets??old.targets;
 if(!['none','even','priority','random_weighted'].includes(String(strategy))||!Array.isArray(targets)||targets.length>100)throw new GapError('invalid_routing');
 const ids=new Set<string>();
 for(const t of targets){
 if(!t||typeof t.staffId!=='string'||ids.has(t.staffId)||!Number.isInteger(t.priority)||t.priority<1||t.priority>100||!Number.isInteger(t.cap)||t.cap<1||t.cap>1000)throw new GapError('invalid_target');
 const s=await db.prepare('SELECT id,role,tenant_id,is_active,access_level FROM staff_members WHERE id=?').bind(t.staffId).first<{id:string;role:'owner'|'admin'|'staff';tenant_id:string;is_active:number;access_level:string}>();
 if(!s||!s.is_active||s.access_level==='read_only'||!await canAccessAllLineAccounts(db,{id:s.id,role:s.role,name:'',tenantId:s.tenant_id,readOnly:false},[a]))throw new GapError('invalid_target');ids.add(t.staffId);
 }
 return {strategy:strategy as RoutingSettings['strategy'],targets};
}
export async function assignInbox(db:D1Database,a:string,friendId:string,now=new Date(),random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296){
 const config=await routingSettings(db,a);if(config.strategy==='none')return false;
 const c=await db.prepare("SELECT c.id FROM chats c JOIN friends f ON f.id=c.friend_id WHERE c.friend_id=? AND f.line_account_id=? AND c.operator_id IS NULL AND c.status!='resolved'").bind(friendId,a).first<{id:string}>();if(!c)return false;
 const tz=await getAccountTimeZone(db,a),day=tzDateStr(tz,now),time=tzHHMM(tz,now),eligible=[];
 for(const t of config.targets){
 const s=await db.prepare(`SELECT m.*,p.away,p.last_seen_at FROM staff_members m JOIN staff_presence p ON p.staff_id=m.id WHERE m.id=? AND m.is_active=1 AND m.access_level!='read_only' AND p.away=0 AND julianday(p.last_seen_at)>=julianday(?,'-30 minutes')`).bind(t.staffId,now.toISOString()).first<{id:string;role:'owner'|'admin'|'staff';tenant_id:string}>();
 if(!s||!await canAccessAllLineAccounts(db,{id:s.id,role:s.role,name:'',tenantId:s.tenant_id,readOnly:false},[a]))continue;
 const bs=await db.prepare('SELECT id FROM staff WHERE staff_member_id=? AND line_account_id=? AND is_active=1 AND deleted_at IS NULL').bind(t.staffId,a).first<{id:string}>();
 if(bs){const shifts=await db.prepare('SELECT count(*) n FROM staff_shifts WHERE staff_id=?').bind(bs.id).first<{n:number}>();if(shifts?.n&&!await db.prepare('SELECT id FROM staff_shifts WHERE staff_id=? AND work_date=? AND start_time<=? AND end_time>?').bind(bs.id,day,time,time).first())continue;}
 const load=await db.prepare(`SELECT count(*) n FROM chats c JOIN friends f ON f.id=c.friend_id WHERE f.line_account_id=? AND c.operator_id=? AND c.status!='resolved' AND c.last_customer_message_at IS NOT NULL AND (c.last_operator_message_at IS NULL OR julianday(c.last_customer_message_at)>julianday(c.last_operator_message_at))`).bind(a,t.staffId).first<{n:number}>();
 if((load?.n??0)>=t.cap)continue;
 const recent=await db.prepare("SELECT count(*) n,MAX(decided_at) last FROM inbox_assignment_logs WHERE account_id=? AND staff_id=? AND julianday(decided_at)>=julianday(?,'-7 days')").bind(a,t.staffId,now.toISOString()).first<{n:number;last:string|null}>();
 eligible.push({...t,count:recent?.n??0,last:recent?.last??''});
 }
 if(!eligible.length)return false;
 eligible.sort((a,b)=>(config.strategy==='even'?a.count-b.count:0)||a.priority-b.priority||a.last.localeCompare(b.last));
 let pick=eligible[0];
 if(config.strategy==='random_weighted'){let cursor=random()*eligible.reduce((n,t)=>n+101-t.priority,0);for(const t of eligible){cursor-=101-t.priority;if(cursor<0){pick=t;break;}}}
 else {const equal=eligible.filter(t=>t.count===pick.count&&t.priority===pick.priority&&t.last===pick.last);pick=equal[Math.floor(random()*equal.length)]??pick;}
 const token=crypto.randomUUID();
 const results=await db.batch([
 db.prepare(`UPDATE chats SET operator_id=?,assigned_by='auto',assigned_at=?,assignment_token=?,revision=revision+1 WHERE id=? AND operator_id IS NULL AND status!='resolved' AND (SELECT count(*) FROM chats c JOIN friends f ON f.id=c.friend_id WHERE f.line_account_id=? AND c.operator_id=? AND c.status!='resolved' AND c.last_customer_message_at IS NOT NULL AND (c.last_operator_message_at IS NULL OR julianday(c.last_customer_message_at)>julianday(c.last_operator_message_at)))<?`).bind(pick.staffId,now.toISOString(),token,c.id,a,pick.staffId,pick.cap),
 db.prepare('INSERT INTO inbox_assignment_logs(id,account_id,chat_id,staff_id,strategy,decided_at,mutation_token) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chats WHERE id=? AND assignment_token=?)').bind(crypto.randomUUID(),a,c.id,pick.staffId,config.strategy,now.toISOString(),token,c.id,token)]);
 return !!results[0].meta.changes;
}
