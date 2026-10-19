import { Hono } from 'hono';
import { afterEach,beforeEach,expect,test,vi } from 'vitest';
import { createReminderWithDraftVersion } from '@line-crm/db';
import { createTestD1,insertFriend } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { reminders } from './reminders.js';

let sql:ReturnType<typeof createTestD1>,app:Hono<Env>,draft:Awaited<ReturnType<typeof createReminderWithDraftVersion>>,staff:Env['Variables']['staff'];
beforeEach(async()=>{
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','HQ'),('other','Other');INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t');INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a','A','a','fixture','fixture','t'),('b','B','b','fixture','fixture','other')");
  insertFriend(sql.raw,'friend',{line_account_id:'a',display_name:'山田'});insertFriend(sql.raw,'foreign',{line_account_id:'b',display_name:'他社'});
  draft=await createReminderWithDraftVersion(sql.db,{name:'案内',lineAccountId:'a',triggerType:'manual',deliveryMode:'countdown',stopConditions:{bookingCancelled:true,supportMarkCompleted:false,daysAfterTarget:null,friendBlocked:true},steps:[{stableStepId:'step',offsetMinutes:0,messageType:'text',messageContent:'{{name}}さん、こんにちは'}]});
  staff={id:'owner',name:'Owner',role:'owner',tenantId:'t',readOnly:false};app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',reminders);
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No external service allowed')}));
});
afterEach(()=>{sql.raw.close();vi.unstubAllGlobals()});
async function call(overrides:Record<string,unknown>={}){
  return app.request(`/api/reminders/${draft.reminder.id}/message-preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({friendId:'friend',stableStepId:'step',expectedDraftVersionId:draft.version.id,expectedDraftUpdatedAt:draft.version.updated_at,...overrides})},{DB:sql.db} as Env['Bindings']);
}
test('same interpolation as delivery without sends, schedule writes or diagnostic writes',async()=>{
  const res=await call();expect(res.status,await res.clone().text()).toBe(200);expect(await res.json()).toMatchObject({data:{dryRun:true,sent:0,persistsSchedule:false,friendName:'山田',messageContent:'山田さん、こんにちは'}});
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  sql.raw.prepare('UPDATE reminder_version_steps SET message_content=? WHERE reminder_version_id=?').run('{{var.missing}}',draft.version.id);
  expect((await call()).status).toBe(200);
  for(const table of ['messages_log','reminder_delivery_runs','friend_reminders','common_var_resolution_failures'])expect(sql.raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});expect(fetch).not.toHaveBeenCalled();
});
test('other account friend, wrong draft/step/date and viewers are rejected',async()=>{
  expect((await call({friendId:'foreign'})).status).toBe(404);expect((await call({expectedDraftVersionId:'old'})).status).toBe(409);expect((await call({stableStepId:'wrong'})).status).toBe(404);expect((await call({deliveredAt:'wrong'})).status).toBe(400);
  expect((await call({expectedDraftUpdatedAt:'old'})).status).toBe(409);
  staff.readOnly=true;expect((await call()).status).toBe(403);staff.readOnly=false;sql.raw.exec("UPDATE staff_members SET tenant_id='other' WHERE id='owner'");staff.tenantId='other';expect((await call()).status).toBe(404);
});
