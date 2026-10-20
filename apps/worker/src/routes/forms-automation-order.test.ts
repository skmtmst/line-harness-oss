import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
const observed = vi.hoisted(()=>vi.fn());
vi.mock('../features/automations/automation-triggers.js',()=>({dispatchAutomationEventWithLogging:observed}));
vi.mock('../services/liff-auth.js',()=>({verifyCallerLineIdentity:vi.fn(async()=>({lineUserId:'Uf',lineAccountId:'a'}))}));
vi.mock('../services/line-proxy-send.js',()=>({pushViaHarnessProxy:vi.fn(async()=>{})}));
vi.mock('../services/operator-notification-dispatch.js',()=>({dispatchOperatorEvent:vi.fn(async()=>{})}));
vi.mock('../services/event-bus.js',()=>({fireOutgoingWebhooks:vi.fn(async()=>{}),fireEvent:vi.fn(async()=>{})}));
const {forms}=await import('./forms.js');
let fixture:SqliteD1;
beforeEach(()=>{
  fixture=createTestD1();observed.mockReset();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('real transport forbidden')}));
  fixture.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('a','人工','a','fake','fake')").run();
  insertFriend(fixture.raw,'f',{line_account_id:'a',metadata:'{"name":"古い値"}'});
  const layout=emptyLayout();layout.sections[0].blocks=[{id:'name',name:'name',kind:'input',type:'text',label:'名前',destinations:{friendFieldIds:['fixed-kana'],note:true}}];
  fixture.raw.prepare('INSERT INTO forms(id,name,layout,save_to_metadata) VALUES(?,?,?,1)').run('form','人工フォーム',JSON.stringify(layout));
  fixture.raw.prepare("INSERT INTO form_accounts(form_id,line_account_id) VALUES('form','a')").run();
  observed.mockImplementation(async()=>{
    const meta=fixture.raw.prepare("SELECT metadata FROM friends WHERE id='f'").get() as {metadata:string};
    const field=fixture.raw.prepare("SELECT value FROM friend_field_values WHERE friend_id='f' AND field_id='fixed-kana'").get() as {value:string}|undefined;
    return {meta:JSON.parse(meta.metadata),field:field?.value};
  });
});
afterEach(()=>{fixture.raw.close();vi.unstubAllGlobals()});
async function submit(){
  const app=new Hono<Env>();app.route('/',forms);const pending:Promise<unknown>[]=[];
  const res=await app.request('/api/forms/form/submit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fake','Idempotency-Key':'aaaaaaaa-1111-4333-8444-111111111111'},body:JSON.stringify({data:{name:'新しい値'}})},{DB:fixture.db,LINE_CHANNEL_ACCESS_TOKEN:'fake',WORKER_URL:'https://fake.test'} as Env['Bindings'],{waitUntil:(p:Promise<unknown>)=>pending.push(p),passThroughOnException:()=>{},props:{}} as ExecutionContext);
  await Promise.all(pending);return res;
}
test('CS-C02: 全登録先が反映されてから自動化の条件を見る',async()=>{
  expect((await submit()).status).toBe(201);
  expect(observed).toHaveBeenCalledTimes(1);
  expect(await observed.mock.results[0].value).toEqual({meta:{name:'新しい値'},field:'新しい値'});
});
test('CS-C02: 一部登録失敗は判定せず失敗表示、再送で成功したメモを重ねない',async()=>{
  fixture.raw.exec("CREATE TEMP TRIGGER fail_field BEFORE INSERT ON friend_field_values BEGIN SELECT RAISE(ABORT,'sqlite fixture failure'); END");
  expect((await submit()).status).toBe(202);
  expect(observed).not.toHaveBeenCalled();
  expect(fixture.raw.prepare('SELECT destination_write_status FROM form_submissions').get()).toEqual({destination_write_status:'partial'});
  fixture.raw.exec('DROP TRIGGER fail_field');
  expect((await submit()).status).toBe(200);
  expect(observed).toHaveBeenCalledTimes(1);
  expect(await observed.mock.results[0].value).toEqual({meta:{name:'新しい値'},field:'新しい値'});
  expect(fixture.raw.prepare("SELECT notes FROM chats WHERE friend_id='f'").get()).toEqual({notes:'新しい値'});
  await submit();expect(observed).toHaveBeenCalledTimes(1);
});
