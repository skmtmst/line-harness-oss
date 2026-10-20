import { grantEntitlement } from '../features/booking/booking-entitlements.js';
import { bookingEntitlements } from './booking-entitlements.js';
import { bookingPayments } from './booking-payments.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { recoverOrphanedOnlineBookings } from '../features/booking/booking-payment-recovery.js';

const availability = vi.hoisted(() => ({ getAvailability: vi.fn() }));
vi.mock('../services/availability.js', async (original) => ({
  ...await original<typeof import('../services/availability.js')>(), ...availability,
}));
const { default: booking } = await import('./booking.js');
const startsAt = '2026-10-26T01:00:00.000Z';
let sql: SqliteD1;
let app: Hono<Env>;
let db: D1Database;
let tasks: Promise<unknown>[];
let failCompletion: boolean;
let failInsert: boolean;
let loseInsertResponse: boolean;
let failRescueRead: boolean;
let verifiedUserId: string;
let pauseInsert: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
  sql = createTestD1({ foreignKeys: true });
  tasks = []; failCompletion = false; failInsert = false; loseInsertResponse = false; failRescueRead = false; verifiedUserId = 'Uw1'; pauseInsert = undefined;
  sql.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, liff_id)
    VALUES ('w1-account', 'w1-channel', '試験', 'token', 'secret', 'w1-liff');
    INSERT INTO booking_settings (id, line_account_id, timezone, approval_mode)
    VALUES ('w1-settings', 'w1-account', 'Asia/Tokyo', 'manual');
    INSERT INTO menus (id, line_account_id, name, duration_minutes, buffer_after_minutes, base_price, concurrent_capacity)
    VALUES ('w1-menu', 'w1-account', '相談', 60, 0, 8000, 2);
    INSERT INTO staff (id, line_account_id, name, display_name) VALUES ('w1-staff', 'w1-account', '担当', '担当');
    INSERT INTO staff_menus (staff_id, menu_id, is_offered) VALUES ('w1-staff', 'w1-menu', 1);
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
    VALUES ('w1-friend', 'Uw1', '予約者', 'w1-account', 1);
    INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
    VALUES ('w1-shift', 'w1-staff', '2026-10-26', '09:00', '23:00');
  `);
  const original = sql.db;
  db = { ...original, prepare(query: string) {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => ({ ...statement,
      bind: (...args: unknown[]) => wrap(statement.bind(...args)),
      first: async <T>() => {
        if (failRescueRead && /SELECT id FROM bookings WHERE id/.test(query)) { failRescueRead = false; throw new Error('rescue read unavailable'); }
        return statement.first<T>();
      },
      run: async () => {
        if (failCompletion && /(?:UPDATE|INSERT INTO) booking_idempotency_keys/.test(query)
          && !query.includes('202')) { failCompletion = false; throw new Error('completion write lost'); }
        return statement.run();
      },
    } as D1PreparedStatement);
    return wrap(original.prepare(query));
  }, async batch(statements: D1PreparedStatement[]) {
    if (statements.some((statement) => /INSERT INTO bookings/.test((statement as unknown as { sql: string }).sql))) {
      if (pauseInsert) { const pause = pauseInsert; pauseInsert = undefined; await pause(); }
      if (failInsert) { failInsert = false; throw new Error('insert transaction failed'); }
    }
    const result = await original.batch(statements);
    if (loseInsertResponse && statements.some((statement) => /INSERT INTO bookings/.test((statement as unknown as { sql: string }).sql))) {
      loseInsertResponse = false; throw new Error('committed insert response lost');
    }
    return result;
  } } as D1Database;
  app = new Hono<Env>(); app.route('/', booking); app.route('/', bookingEntitlements); app.route('/',bookingPayments);
  availability.getAvailability.mockResolvedValue({ by_staff: [{ staff_id: 'w1-staff', display_name: '担当', slots: [{
    date: '2026-10-26', start: '10:00', end: '11:00', timeZone: 'Asia/Tokyo', startUtc: startsAt,
    endUtc: '2026-10-26T02:00:00.000Z', capacity: 2, remaining: 2, state: 'available',
  }] }] });
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/oauth2/v2.1/verify')) return Response.json({ sub: verifiedUserId });
    throw new Error('external network forbidden');
  });
});
afterEach(async () => { await Promise.allSettled(tasks); sql.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function create(key = 'w1-key',extra:Record<string,unknown>={}) {
  return app.request('/api/liff/booking/requests?liffId=w1-liff', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, Authorization: 'Bearer local-token' },
    body: JSON.stringify({ menu_id: 'w1-menu', staff_id: 'w1-staff', starts_at: startsAt,...extra }),
  }, { DB: db } as Env['Bindings'], { waitUntil: (task: Promise<unknown>) => tasks.push(task), passThroughOnException() {} } as unknown as ExecutionContext);
}
function count(table: 'bookings' | 'booking_audit_logs') {
  return (sql.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('W1 LIFF予約のキー確保と保存失敗回収（実SQL・FK有効）', () => {
  it.each(['onsite', 'none'])('REV-I1: %sで手動承認の予約を作ったあとonlineへ変更しても枠を保つ', async mode => {
    sql.raw.prepare(`INSERT INTO booking_payment_configs
      (line_account_id,mode,provider,hold_minutes,created_at,updated_at)
      VALUES ('w1-account',?,'stripe',10,'2026-10-01','2026-10-01')`).run(mode);
    const response = await create();
    expect(response.status).toBe(201);
    const body = await response.json() as {booking_id:string;status:string;payment_required:boolean};
    expect(body).toMatchObject({status:'requested',payment_required:false});
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM booking_payments').get()).toEqual({n:0});
    sql.raw.exec("UPDATE booking_payment_configs SET mode='online'");
    await recoverOrphanedOnlineBookings(db, new Date(Date.now()+10*60000));
    expect(sql.raw.prepare('SELECT status FROM bookings WHERE id=?').get(body.booking_id)).toEqual({status:'requested'});
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM booking_slot_allocations').get()).toEqual({n:1});
    expect(sql.raw.prepare("SELECT COUNT(*) n FROM booking_audit_logs WHERE action='expired'").get()).toEqual({n:0});
  });
  it('REV-H2: 旧版で支払い記録なしの成功が保存されていても再読込を成功にしない', async () => {
    sql.raw.exec(`INSERT INTO booking_payment_configs (line_account_id,mode,provider,hold_minutes,created_at,updated_at)
      VALUES ('w1-account','online','stripe',10,'2026-10-01','2026-10-01')`);
    expect((await create()).status).toBe(201);
    sql.raw.exec(`DELETE FROM booking_payments;
      UPDATE booking_idempotency_keys SET response_body=json_remove(response_body,'$.payment','$.payment_required')`);
    expect((await create()).status).toBe(500);
    expect(count('bookings')).toBe(1);
  });
  it('REV-H2: 支払い記録の保存失敗を成功にせず予約と枠を残さない', async () => {
    sql.raw.exec(`UPDATE booking_settings SET approval_mode='automatic';
      INSERT INTO booking_payment_configs (line_account_id,mode,provider,hold_minutes,created_at,updated_at)
      VALUES ('w1-account','online','stripe',10,'2026-10-01','2026-10-01');
      CREATE TRIGGER fail_payment BEFORE INSERT ON booking_payments
      BEGIN SELECT RAISE(ABORT,'payment insert failed'); END;`);
    const response = await create();
    expect(response.status).toBe(500);
    expect(count('bookings')).toBe(0);
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM booking_slot_allocations').get()).toEqual({ n: 0 });
    sql.raw.exec('DROP TRIGGER fail_payment');
    expect((await create()).status).toBe(201);
  });
  it('定員2の枠でも同じキーの並行要求は予約1件だけを残す', async () => {
    let started!: () => void; let resume!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    pauseInsert = async () => { started(); await gate; };
    const first = create(); await entered;
    const second = await create(); resume(); const winner = await first;
    expect(count('bookings')).toBe(1);
    expect(winner.status).toBe(201); expect(second.status).toBe(409); expect(count('booking_audit_logs')).toBe(1);
    const replay = await create(); expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await winner.json()); expect(count('bookings')).toBe(1);
  });
  it('予約保存後に完成応答の保存だけ落ちても同じ予約を回収する', async () => {
    failCompletion = true;
    await create();
    const created = sql.raw.prepare('SELECT id, status FROM bookings').get() as { id: string; status: string };
    expect(created).toBeDefined();
    const replay = await create(); expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ booking_id: created.id, status: created.status });
    expect(count('bookings')).toBe(1); expect(count('booking_audit_logs')).toBe(1);
  });
  it('commit済みINSERTの応答消失ではキーを消さず予約を作り直さない', async () => {
    loseInsertResponse = true; expect((await create()).status).toBe(500);
    const row = sql.raw.prepare('SELECT id FROM bookings').get() as { id: string };
    expect(sql.raw.prepare('SELECT response_status FROM booking_idempotency_keys').get()).toEqual({ response_status: 202 });
    const replay = await create(); expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ booking_id: row.id }); expect(count('bookings')).toBe(1);
  });
  it('救出読取が不明ならキーを残し新規予約へ進めない', async () => {
    failInsert = true; failRescueRead = true; expect((await create()).status).toBe(500);
    expect(count('bookings')).toBe(0);
    expect(sql.raw.prepare('SELECT response_status FROM booking_idempotency_keys').get()).toEqual({ response_status: 202 });
    expect((await create()).status).toBe(409); expect(count('bookings')).toBe(0);
  });
  it('別の本人による同じキーの再利用では予約IDを返さず行も増やさない', async () => {
    expect((await create()).status).toBe(201);
    sql.raw.exec(`INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('other-w1-friend', 'Uw1-other', '別', 'w1-account', 1);`);
    verifiedUserId = 'Uw1-other';
    const result = await create(); expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'idempotency_key_conflict' }); expect(count('bookings')).toBe(1);
  });
  it('予約INSERTの失敗では自分の確保だけを解放して再送できる', async () => {
    failInsert = true; expect((await create()).status).toBe(500);
    expect(count('bookings')).toBe(0);
    expect(sql.raw.prepare('SELECT key FROM booking_idempotency_keys').all()).toEqual([]);
    expect((await create()).status).toBe(201); expect(count('bookings')).toBe(1);
  });
});

describe('LIFFの券と本人が選ぶ支払い',()=>{
 const choice=()=>sql.raw.exec(`INSERT INTO booking_payment_configs(line_account_id,mode,provider,hold_minutes,created_at,updated_at)
 VALUES('w1-account','customer_choice','stripe',10,'2026-10-01','2026-10-01')`);
 it.each(['onsite','online'] as const)('本人が%sを選んだ方法を保存し、再送/設定変更後も同じ予約を返す',async method=>{
  choice();sql.raw.exec("UPDATE booking_settings SET approval_mode='automatic'");
  const first=await create('choice',{payment_method:method});expect(first.status).toBe(201);
  const data=await first.json<{booking_id:string;status:string;payment_required:boolean}>();
  expect(data).toMatchObject({status:method==='onsite'?'confirmed':'requested',payment_required:method==='online'});
  expect(sql.raw.prepare('SELECT mode FROM booking_payment_choices').get()).toEqual({mode:method});
  sql.raw.exec("UPDATE booking_payment_configs SET mode='online'");
  const again=await create('choice',{payment_method:method});expect(again.status).toBe(201);expect((await again.json<{booking_id:string}>()).booking_id).toBe(data.booking_id);
  expect(count('bookings')).toBe(1);
  if(method==='onsite'){
   const pay=await app.request('/api/liff/booking/payments/start?liffId=w1-liff',{method:'POST',headers:{Authorization:'Bearer local-token','Content-Type':'application/json'},body:JSON.stringify({bookingId:data.booking_id})},{DB:db} as Env['Bindings']);
   expect(pay.status).toBe(409);
  }
 });
 it('不正な選択・別の固定方式への変更は拒否',async()=>{
  choice();
  expect((await create('bad',{payment_method:'none'})).status).toBe(400);
  sql.raw.exec("UPDATE booking_payment_configs SET mode='online'");
  expect((await create('wrong',{payment_method:'onsite'})).status).toBe(400);
  expect(count('bookings')).toBe(0);
 });
 it.each(['none','onsite','online','customer_choice'] as const)('644適用後、選択欄のないLIFFは店の%s設定で予約でき、再送でも写しを保つ',async mode=>{
  expect(sql.raw.prepare("SELECT sql FROM sqlite_master WHERE name='booking_payment_configs'").get()).toMatchObject({sql:expect.stringContaining('customer_choice')});
  sql.raw.prepare(`INSERT INTO booking_payment_configs VALUES('w1-account',?,?,10,'2026-10-01','2026-10-01')`).run(mode,mode==='customer_choice'||mode==='online'?'stripe':mode);
  sql.raw.exec(`INSERT INTO booking_payment_menu_settings VALUES('w1-menu','w1-account','customer_choice','stripe','2026-10-01','2026-10-01');
    UPDATE booking_settings SET approval_mode='automatic'`);
  const response=await create('legacy-choice');expect(response.status).toBe(201);
  const data=await response.json<{booking_id:string;payment_required:boolean;status:string}>();
  const online=mode==='online'||mode==='customer_choice';
  expect(data).toMatchObject({payment_required:online,status:online?'requested':'confirmed'});
  const saved=sql.raw.prepare('SELECT mode FROM booking_payment_choices').get();
  expect(saved).toEqual(mode==='none'?undefined:{mode:online?'online':'onsite'});
  expect(sql.raw.prepare('SELECT count(*) n FROM booking_payments').get()).toEqual({n:online?1:0});
  sql.raw.exec("UPDATE booking_payment_configs SET mode='onsite'; UPDATE booking_payment_menu_settings SET mode='online'");
  const replay=await create('legacy-choice');expect(replay.status).toBe(201);expect(await replay.json()).toMatchObject({booking_id:data.booking_id,payment_required:online});
  expect(count('bookings')).toBe(1);
 });
 it('メニュー上書きなし・店が本人選択でも選択欄なしなら店の決済先を使う',async()=>{
  choice();const response=await create('store-choice');expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({payment_required:true,status:'requested'});
  expect(sql.raw.prepare('SELECT mode,provider FROM booking_payment_choices').get()).toEqual({mode:'online',provider:'stripe'});
 });
 async function grant(){return grantEntitlement(db,'w1-account','operator','manual:test',{
  friendId:'w1-friend',kind:'ticket',name:'2回券',remaining:2,validFrom:'2026-01-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',reason:'現金販売',
 });}
 it('券を選んで予約し、確定で1回減る。本人は残りを読め、理由/担当者は見えない',async()=>{
  const e=await grant();
  const response=await create('ticket',{entitlement_id:e.data.id});expect(response.status).toBe(201);
  const saved=await response.json<{booking_id:string}>();
  expect(sql.raw.prepare('SELECT remaining FROM booking_entitlements').get()).toEqual({remaining:2});
  sql.raw.prepare("UPDATE bookings SET status='confirmed' WHERE id=?").run(saved.booking_id);
  expect(sql.raw.prepare('SELECT remaining FROM booking_entitlements').get()).toEqual({remaining:1});
  expect((await create('ticket',{entitlement_id:e.data.id})).status).toBe(201);
  const mine=await app.request('/api/liff/booking/entitlements?liffId=w1-liff', {headers:{Authorization:'Bearer local-token'}},{DB:db} as Env['Bindings']);
  expect(mine.status).toBe(200);const body=await mine.json<{data:{remaining:number}[]}>();expect(body.data[0].remaining).toBe(1);expect(JSON.stringify(body)).not.toContain('現金販売');expect(JSON.stringify(body)).not.toContain('operator');
  verifiedUserId='someone-else';const other=await app.request('/api/liff/booking/entitlements?liffId=w1-liff',{headers:{Authorization:'Bearer local-token'}},{DB:db} as Env['Bindings']);expect(other.status).toBe(404);
 });
 it('券を選んだ即時確定はオンライン請求せず、DBの減算失敗は予約/枠を残さない',async()=>{
  const e=await grant();choice();sql.raw.exec("UPDATE booking_settings SET approval_mode='automatic'");
  sql.raw.exec("CREATE TRIGGER fail_consume BEFORE UPDATE ON booking_entitlements BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;");
  expect((await create('auto-ticket',{entitlement_id:e.data.id})).status).toBe(409);expect(count('bookings')).toBe(0);
  sql.raw.exec('DROP TRIGGER fail_consume');
  const response=await create('auto-ticket',{entitlement_id:e.data.id});expect(response.status).toBe(201);expect(await response.json()).toMatchObject({status:'confirmed',payment_required:false});
  expect(sql.raw.prepare('SELECT remaining FROM booking_entitlements').get()).toEqual({remaining:1});
  expect(sql.raw.prepare('SELECT count(*) n FROM booking_payments').get()).toEqual({n:0});
 });
});
