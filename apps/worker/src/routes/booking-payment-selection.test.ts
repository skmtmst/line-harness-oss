import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gapApp, gapFixture } from '../test-utils/gap1.js';
import { setNoshowFlagMode, saveNoshowSettings } from '@line-crm/db';
import { bookingGap3 } from './booking-gap3.js';
import { bookingPayments } from './booking-payments.js';

const availability = vi.hoisted(() => ({ getAvailability: vi.fn() }));
vi.mock('../services/availability.js', async original => ({ ...await original<typeof import('../services/availability.js')>(), ...availability }));
const { default: booking } = await import('./booking.js');
let d: ReturnType<typeof gapFixture>;
let user = 'Uf';
let tasks: Promise<unknown>[];
const start = '2026-11-20T05:00:00.000Z';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-18T04:00:00Z'));
  d = gapFixture(); user = 'Uf'; tasks = [];
  d.raw.exec(`UPDATE booking_settings SET approval_mode='automatic';
    INSERT INTO booking_payment_configs(line_account_id,mode,provider,hold_minutes,created_at,updated_at)
      VALUES('a','customer_choice','stripe',10,'2026-11-18','2026-11-18');
    INSERT INTO staff_shifts(id,staff_id,work_date,start_time,end_time) VALUES('shift','bs','2026-11-20','09:00','18:00');`);
  availability.getAvailability.mockResolvedValue({ by_staff: [{ staff_id: 'bs', display_name: '担当', slots: [{
    date: '2026-11-20', start: '14:00', end: '15:00', startUtc: start, endUtc: '2026-11-20T06:00:00.000Z',
    timeZone: 'Asia/Tokyo', state: 'available', remaining: 1,
  }] }] });
  vi.stubGlobal('fetch', vi.fn(async input => {
    if (String(input).includes('oauth2/v2.1/verify')) return Response.json({ sub: user });
    throw Error('external_network_forbidden');
  }));
});
afterEach(async () => { await Promise.allSettled(tasks); d.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function request(path: string, body?: Record<string, unknown>, key = 'choice') {
  return gapApp(d, [booking, bookingGap3, bookingPayments]).request(`/api/liff/booking/${path}${path.includes('?') ? '&' : '?'}liffId=liff-a`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': key },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, undefined, { waitUntil: task => tasks.push(task), passThroughOnException() {}, props: {} });
}
const estimate = () => request(`cost-estimate?menu_id=menu&staff_id=bs&starts_at=${start}`);
const create = (method?: 'online' | 'onsite', key?: string) => request('requests', {
  menu_id: 'menu', staff_id: 'bs', starts_at: start, ...(method ? { payment_method: method } : {}),
}, key);

it('本人向けの見積もりは店とメニューの実条件から選択肢を返し、制限理由を漏らさない', async () => {
  expect(await (await estimate()).json()).toMatchObject({ success: true, data: { payment: { mode: 'customer_choice', allowedMethods: ['online', 'onsite'] } } });
  await setNoshowFlagMode(d.db, 'a', 'f', 'manual_on');
  const body = await (await estimate()).json();
  expect(body).toMatchObject({ data: { payment: { mode: 'customer_choice', allowedMethods: ['online'] } } });
  expect(JSON.stringify(body)).not.toMatch(/prepayOnly|noshow|no_show|manual_on/);
  await saveNoshowSettings(d.db, 'a', { enabled: false, threshold: 3, windowMonths: 6, noPaymentMode: 'notice' });
  expect(await (await estimate()).json()).toMatchObject({ data: { payment: { allowedMethods: ['online', 'onsite'] } } });
});

it('別人の前払い限定を使わず、本人がいない・他店のメニューでは条件を返さない', async () => {
  await setNoshowFlagMode(d.db, 'a', 'f2', 'manual_on');
  expect(await (await estimate()).json()).toMatchObject({ data: { payment: { allowedMethods: ['online', 'onsite'] } } });
  user = 'Uunknown'; expect((await estimate()).status).toBe(404);
  user = 'Uf';
  d.raw.exec("INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('other-menu','b','他店',60,8400)");
  expect((await request(`cost-estimate?menu_id=other-menu&starts_at=${start}`)).status).toBe(404);
  expect((await gapApp(d, [bookingGap3]).request(`/api/liff/booking/cost-estimate?menu_id=menu&starts_at=${start}&liffId=liff-a`)).status).toBe(401);
});

it('自動の回数判定と手動解除も同じ本人条件から選択肢を決める', async () => {
  for (let i = 0; i < 4; i++) d.raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES(?,'a','f','bs','menu','2026-11-01T05:00:00Z','2026-11-01T06:00:00Z','2026-11-01T06:00:00Z','no_show',8400,'2026-10-01')`).run(`noshow-${i}`);
  expect(await (await estimate()).json()).toMatchObject({ data: { payment: { allowedMethods: ['online'] } } });
  await setNoshowFlagMode(d.db, 'a', 'f', 'manual_off');
  expect(await (await estimate()).json()).toMatchObject({ data: { payment: { allowedMethods: ['online', 'onsite'] } } });
});

it.each(['none', 'onsite', 'online'] as const)('メニューの固定%sを優先し、固定方式で別の方法を受け付けない', async mode => {
  d.raw.prepare("INSERT INTO booking_payment_menu_settings VALUES('menu','a',?,'stripe','2026-11-18','2026-11-18')").run(mode);
  expect(await (await estimate()).json()).toMatchObject({ data: { payment: { mode, allowedMethods: mode === 'none' ? [] : [mode] } } });
  const response = await create(mode === 'online' ? 'onsite' : 'online');
  expect(response.status).toBe(400); expect(d.raw.prepare('SELECT count(*) n FROM bookings').get()).toEqual({ n: 0 });
});

it('前払い限定は偽の店頭指定を保存前に拒否し、選択のない旧画面でもオンラインへ固定する', async () => {
  await setNoshowFlagMode(d.db, 'a', 'f', 'manual_on');
  d.raw.exec("UPDATE booking_payment_configs SET mode='onsite'; INSERT INTO booking_payment_menu_settings VALUES('menu','a','customer_choice','stripe','2026-11-18','2026-11-18')");
  const denied = await create('onsite', 'denied');
  expect(denied.status).toBe(400); expect(await denied.json()).toMatchObject({ code: 'payment_method_not_allowed', fields: { payment_method: expect.any(String) } });
  expect(d.raw.prepare('SELECT count(*) n FROM bookings').get()).toEqual({ n: 0 });
  const response = await create(undefined, 'legacy');
  expect(response.status, await response.clone().text()).toBe(201);
  expect(await response.json()).toMatchObject({ status: 'requested', payment_required: true });
  expect(d.raw.prepare('SELECT mode,provider FROM booking_payment_choices').get()).toEqual({ mode: 'online', provider: 'stripe' });
  expect(d.raw.prepare('SELECT count(*) n FROM booking_payments').get()).toEqual({ n: 1 });
});

it.each(['onsite', 'online'] as const)('本人が%sを選ぶと予約・支払写しが同時保存され、再送と設定変更で変わらない', async method => {
  const response = await create(method);
  expect(response.status, await response.clone().text()).toBe(201);
  const result = await response.json() as { booking_id: string };
  expect(d.raw.prepare('SELECT mode FROM booking_payment_choices').get()).toEqual({ mode: method });
  expect(d.raw.prepare('SELECT count(*) n FROM booking_payments').get()).toEqual({ n: method === 'online' ? 1 : 0 });
  d.raw.exec("UPDATE booking_payment_configs SET mode='online'");
  expect(await (await create(method)).json()).toMatchObject({ booking_id: result.booking_id });
  expect(d.raw.prepare('SELECT count(*) n FROM bookings').get()).toEqual({ n: 1 });
});

it('オンラインでも無料なら支払行や外部checkoutを作らず、予約は従来どおり確定する', async () => {
  d.raw.exec('UPDATE menus SET base_price=0');
  const response = await create('online'); expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ status: 'confirmed', payment_required: false });
  expect(d.raw.prepare('SELECT count(*) n FROM booking_payments').get()).toEqual({ n: 0 });
});
