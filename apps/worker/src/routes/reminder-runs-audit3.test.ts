import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { listReminderDeliveryRuns, getReminderDeliveryRunSummary } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: async () => true,
  getVisibleLineAccountScope: async () => ({ allowedAccountIds: ['a'], canSeeUnassigned: false }),
}));
import { reminders } from './reminders.js';
let fixture: SqliteD1;
const scope = { allowedAccountIds: ['a'], canSeeUnassigned: false };
beforeEach(() => {
  fixture = createTestD1();
  for (const id of ['a','b']) fixture.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,'t','s')").run(id,id,id);
  fixture.raw.exec("INSERT INTO reminders(id,name,line_account_id) VALUES('r','R','a'); INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content) VALUES('s','r',0,'text','hello')");
});
afterEach(() => fixture.raw.close());
function run(id: string, status: string, hours: number, account = 'a') {
  const date = new Date(Date.now()+hours*3600000).toISOString();
  fixture.raw.prepare(`INSERT INTO reminder_delivery_runs(id,line_account_id,reminder_id,friend_reminder_id,friend_id,reminder_step_id,scheduled_at,idempotency_key,line_retry_key,status,created_at,updated_at,completed_at,next_retry_at)
    VALUES(?,?,'r',?,'f','s',?,?,?,?,'2026-10-01','2026-10-01',?,?)`).run(id,account,id,date,id,id,status,status==='queued'?null:date,status==='retry_wait'?date:null);
}
test('WEB084 first page returns nearest of 105 plans and counts all due soon within account scope', async () => {
  for (let i=0;i<105;i++) run(`q${i}`,'queued',i+1);
  run('hidden','queued',1,'b');
  const list = await listReminderDeliveryRuns(fixture.db,{ reminderId:'r',status:'queued',order:'scheduled_asc',limit:2,offset:0,scope });
  expect(list.items.map(row=>row.id)).toEqual(['q0','q1']);
  expect(list.total).toBe(105);
  expect(await getReminderDeliveryRunSummary(fixture.db,'r',scope)).toMatchObject({ scheduled:105, scheduledNext24Hours:24 });
});
test('WEB084 executed filter happens before LIMIT, including failed attempts; HTTP forwards and validates options', async () => {
  for(let i=0;i<6;i++) run(`future${i}`,'queued',100+i);
  run('done','succeeded',-2); run('retry','retry_wait',-1);
  const app = new Hono<Env>(); app.route('/',reminders);
  const response = await app.request('/api/reminders/r/runs?executedOnly=true&limit=2',{}, {DB:fixture.db} as Env['Bindings']);
  expect(response.status).toBe(200);
  const body = await response.json() as any;
  expect(body.data.items.map((row: any)=>row.id)).toEqual(['retry','done']);
  expect(body.data.pagination.total).toBe(2);
  expect((await app.request('/api/reminders/r/runs?order=bad',{}, {DB:fixture.db} as Env['Bindings'])).status).toBe(400);
});
