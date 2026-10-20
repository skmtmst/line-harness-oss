import { afterEach, beforeEach, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { hqSupport } from './hq-support.js';

let fixture: SqliteD1;
beforeEach(()=>{fixture=createTestD1();});
afterEach(()=>fixture.raw.close());
function request(tenantId=DEFAULT_TENANT_ID) {
  const app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'reader',name:'閲覧者',role:'staff',tenantId,readOnly:true});await next();});app.route('/',hqSupport);
  return app.request('/api/hq/support/summary',{}, {DB:fixture.db});
}
it('問い合わせ全体を統括で絞り、未返信の平均は0にしない',async()=>{
  expect(await (await request()).json()).toMatchObject({data:{total:0,newCount:0,inProgressCount:0,resolvedThisMonth:0,averageFirstReplyHours:null,firstReplySampleCount:0}});
  const insert=fixture.raw.prepare(`INSERT INTO hq_support_requests(id,tenant_id,kind,subject,body,stage,assignee_staff_id,created_at,first_replied_at,resolved_at)
    VALUES(?,?,'bug','問い合わせ','本文',?,?,?, ?,?)`);
  insert.run('new',DEFAULT_TENANT_ID,'new',null,'2026-10-01T10:00:00',null,null);
  insert.run('progress',DEFAULT_TENANT_ID,'in_progress','assigned','2026-10-01T10:00:00','2026-10-01T12:00:00',null);
  const current=fixture.raw.prepare("SELECT datetime('now','+9 hours','start of month') AS at").get() as {at:string};
  const previous=fixture.raw.prepare("SELECT datetime('now','+9 hours','start of month','-1 month') AS at").get() as {at:string};
  insert.run('resolved',DEFAULT_TENANT_ID,'resolved',null,'2026-10-01T10:00:00','2026-10-01T14:00:00',current.at);
  insert.run('previous',DEFAULT_TENANT_ID,'closed',null,'2026-10-01T10:00:00',null,previous.at);
  fixture.raw.exec("INSERT INTO tenants(id,name) VALUES('other','別組織')");
  insert.run('other','other','new',null,'2026-10-01T10:00:00',null,null);
  const body=await (await request()).json() as {data:Record<string,number>};
  expect(body.data).toMatchObject({total:4,newCount:1,inProgressCount:1,assignedInProgressCount:1,resolvedThisMonth:1,resolvedPreviousMonth:1,firstReplySampleCount:2});
  expect(body.data.averageFirstReplyHours).toBeCloseTo(3);
  expect(await (await request('other')).json()).toMatchObject({data:{total:1,newCount:1,averageFirstReplyHours:null}});
});
