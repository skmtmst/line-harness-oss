import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import {createTestD1,type SqliteD1} from './d1-sqlite.js';
export const gapOwner:AuthenticatedStaff={id:'o',name:'管理者',role:'owner',readOnly:false,tenantId:'t'};
export function gapFixture(){
 const d=createTestD1();d.raw.exec(`INSERT INTO tenants(id,name) VALUES('t','店'),('other','他店');
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id,liff_id) VALUES('a','ch','店','test-token','secret','t','liff-a'),('b','ch2','他店','test-token','secret','other','liff-b');
 INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope,permission_keys) VALUES('o','管理者','owner','owner-key','t','all','[]'),('s','担当','staff','staff-key','t','all','["/chats","booking.staff.own","/booking/bookings"]');
 INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES('f','Uf','お客さま','a'),('f2','Uf2','別のお客さま','a');
 INSERT INTO staff(id,line_account_id,name,display_name,staff_member_id) VALUES('bs','a','担当','担当','s'),('bs2','a','別担当','別担当',NULL);
 INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('menu','a','相談',60,8400);
 INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('bs','menu',1);
 INSERT INTO booking_settings(id,line_account_id,timezone) VALUES('settings','a','Asia/Tokyo');`);
 return d;
}
export function seedGapBooking(d:SqliteD1,id='bk',status='confirmed',start='2026-11-20T05:00:00Z') {
 d.raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at,decided_at)
 VALUES(?,'a','f','bs','menu',?,?,?,?,8400,'2026-10-16T00:00:00Z','2026-10-16T00:00:00Z')`).run(id,start,new Date(Date.parse(start)+3600000).toISOString(),new Date(Date.parse(start)+3600000).toISOString(),status);
}
export function gapApp(d:SqliteD1,routes:Hono<Env>[],staff=gapOwner,im=false,bindings:Partial<Env['Bindings']>={}){
 const a=new Hono<Env>();a.use('*',async(c,next)=>{c.env={DB:d.db,STRIPE_TEST_WEBHOOK_SECRET:'test-webhook-secret',...bindings} as Env['Bindings'];c.set('staff',staff);if(im)c.set('impersonation',{id:'im',tenantId:'t',mode:'write',piiRevealed:true,startedAt:'2026-10-16'});await next();});for(const r of routes)a.route('/',r);return a;
}
export async function gapCall(a:Hono<Env>,path:string,method='GET',body?:unknown,key=crypto.randomUUID()):Promise<Response> {
 return a.request(path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
