import { scenarios } from './scenarios.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { recordBookingAudit, upsertEcEventReadModels, createWebinar, saveWebinarEditorSettings, updateWebinar, getWebinarEditorSettings, updateMedia } from '@line-crm/db';
import { scoring } from './scoring.js';
import { affiliates } from './affiliates.js';
import type { Env } from '../worker-env.js';
let t: SqliteD1;
beforeEach(() => {
  t = createTestD1();
  for (const id of ['a', 'b']) {
    t.raw.prepare("INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES (?,?,'店','token','secret')").run(id, 'ch'+id);
    t.raw.prepare("INSERT INTO friends (id,line_user_id,line_account_id) VALUES (?, ?, ?)").run('f'+id, 'U'+id, id);
  }
});
afterEach(() => t.raw.close());
function app(role: 'owner'|'admin'|'staff' = 'owner', readOnly = false, permissionKeys: string[] = []) {
  const app = new Hono<Env>();
  app.use('*', async (c,next)=>{ c.env = { DB: t.db } as Env['Bindings']; c.set('staff', { id: 'env-owner', name: '担当', role, readOnly, permissionKeys }); await next(); });
  app.route('/', scoring); app.route('/', scenarios); app.route('/', affiliates); return app;
}
function seedConversion(id: string, type: string, policy = 'source_cancelled', account = 'a') {
  t.raw.prepare("INSERT INTO conversion_points (id,name,event_type,status,line_account_id,reversal_policy) VALUES (?,? ,?,'active',?,?)").run('p'+id,id,type,account,policy);
  t.raw.prepare('INSERT INTO conversion_events (id,conversion_point_id,friend_id,metadata,value_snapshot) VALUES (?,?,?,?,1000)').run(id,'p'+id,'f'+account,JSON.stringify({ bookingId:'booking', orderNumber:'order-1' }));
}

describe('元業務の取消と成果', () => {
  test('予約取消の確定後に自動取消し、再実行でも1件・元の金額は保持', async () => {
    seedConversion('auto','reservation_confirmed'); seedConversion('manual','reservation_confirmed','manual'); seedConversion('other','reservation_confirmed','source_cancelled','b');
    const audit = { bookingId:'booking', lineAccountId:'a', action:'status_changed', after:{ status:'cancelled' }, actorType:'system' as const, occurredAt:new Date().toISOString() };
    await recordBookingAudit(t.db,audit); await recordBookingAudit(t.db,audit);
    expect(t.raw.prepare('SELECT conversion_event_id FROM conversion_event_reversals').all()).toEqual([{ conversion_event_id:'auto' }]);
    expect(t.raw.prepare("SELECT value_snapshot FROM conversion_events WHERE id='auto'").get()).toEqual({ value_snapshot:1000 });
  });
  test('EC返品が取り込まれたら該当注文だけ自動取消する', async () => {
    seedConversion('ec','ec_order_confirmed');
    t.raw.prepare("INSERT INTO ec_events (id,source,external_event_id,event_type,line_user_id,payload,received_at,updated_at) VALUES ('ec-return','eccube','return','ec.order.refunded','Ua','{}',?,?)").run(new Date().toISOString(),new Date().toISOString());
    const input = { eventId:'ec-return', sourceKey:'eccube', externalEventId:'return', eventType:'ec.order.refunded', lineAccountId:'a', customerId:null, friendId:'fa', occurredAt:new Date().toISOString(), order:{ number:'order-1',total:1000 } };
    await upsertEcEventReadModels(t.db,input); await upsertEcEventReadModels(t.db,input);
    expect(t.raw.prepare('SELECT conversion_event_id FROM conversion_event_reversals').all()).toEqual([{ conversion_event_id:'ec' }]);
  });
});

test('ウェビナー基本保存も原子的に版を進め、古い版を上書きしない', async () => {
  const webinar = await createWebinar(t.db,{ accountId:'a',title:'最初',slug:'test',durationSeconds:100,status:'active' });
  await saveWebinarEditorSettings(t.db,webinar.id,0,{});
  expect(await updateWebinar(t.db,webinar.id,{ title:'先に保存' },1)).toMatchObject({ title:'先に保存' });
  expect(await updateWebinar(t.db,webinar.id,{ title:'古い保存' },1)).toBeNull();
  expect(await getWebinarEditorSettings(t.db,webinar.id)).toMatchObject({ version:2 });
  expect(t.raw.prepare('SELECT version,state FROM webinar_versions WHERE webinar_id=? ORDER BY version').all(webinar.id)).toEqual([{version:1,state:'draft'},{version:2,state:'draft'}]);
});

test('メディア名の保存は同じ版を使って二度上書きできない', async () => {
  t.raw.prepare("INSERT INTO media (id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES ('m','a','image','old.png','image/png',1,'test.png')").run();
  expect(await updateMedia(t.db,'m','a',{filename:'first.png',expectedRevision:1})).toMatchObject({filename:'first.png',revision:2});
  expect(await updateMedia(t.db,'m','a',{filename:'stale.png',expectedRevision:1})).toBeNull();
});

describe('マイル・スコアのCSVと旧口', () => {
  const request = (instance: ReturnType<typeof app>, kind: string, reason = '月次確認') => instance.request('/api/mileage/exports',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:'a',kind,reason}) });
  test.each(['balances','history','rewards','scores'])('%s は閲覧のみと許可なしを断り、監査してから渡す', async kind => {
    expect((await request(app('owner',true),kind)).status).toBe(403);
    expect((await request(app('staff'),kind)).status).toBe(403);
    expect((await request(app('admin'),kind)).status).toBe(403);
    const response = await request(app(),kind);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(t.raw.prepare('SELECT reason,line_account_id FROM audit_events WHERE action IN (?,?)').all('mileage.ledger.export','action_score.list.export')).toEqual([{ reason:'月次確認',line_account_id:'a' }]);
  });
  test('理由なしのCSVを断る',async()=>{expect((await request(app(),'balances','')).status).toBe(400);});
  test('全店共通の古いルール口からは内容を返さない',async()=>{expect((await app().request('/api/scoring-rules')).status).toBe(410);});
  test('理由・操作番号なしの点数変更を断る',async()=>{
    for(const [body,headers] of [[{scoreChange:1},{'Content-Type':'application/json','Idempotency-Key':'reason-required'}],[{scoreChange:1,reason:'確認'},{'Content-Type':'application/json'}]] as const) {
      const response=await app().request('/api/friends/fa/score',{method:'POST',headers,body:JSON.stringify(body)});
      expect(response.status).toBe(400);
    }
  });
});


test('紹介者一覧は両店を見られる管理者にも選んだ店だけ返す', async () => {
  for (const id of ['a','b']) t.raw.prepare('INSERT INTO affiliates (id,line_account_id,name,code,tenant_id) VALUES (?,?,?,?,?)').run('affiliate-'+id,id,'紹介者'+id,'code-'+id,DEFAULT_TENANT_ID);
  const response = await app().request('/api/affiliates?accountId=a');
  expect(response.status).toBe(200);
  expect((await response.json() as { data: {id:string}[] }).data.map(row=>row.id)).toEqual(['affiliate-a']);
});


test('許可された管理者はCSVを出せるが別種類の鍵は流用できない', async () => {
  for (const [kind,key] of [['balances','mileage.ledger.export'],['scores','action_score.list.export']]) {
    const response = await app('admin',false,[key]).request('/api/mileage/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:'a',kind,reason:'確認'})});
    expect(response.status).toBe(200);
  }
  const wrongKey=await app('admin',false,['mileage.ledger.export']).request('/api/mileage/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:'a',kind:'scores',reason:'確認'})});
  expect(wrongKey.status).toBe(403);
});


test('スタッフのシナリオ作成は有効指定を省いても下書きだけになる', async () => {
  const response = await app('staff',false,['/scenarios','scenario.definition.edit']).request('/api/scenarios',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'下書き',triggerType:'manual',lineAccountId:'a'})});
  expect(response.status).toBe(201);
  expect(t.raw.prepare("SELECT is_active FROM scenarios WHERE name='下書き'").get()).toEqual({is_active:0});
});


test.each([{accountId:1,kind:'balances',reason:'確認'},{accountId:'a',kind:'balances',reason:3}])('CSVの不正な入力型を500にせず断る: %j', async body => {
  const response=await app().request('/api/mileage/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect(response.status).toBe(400);
});
