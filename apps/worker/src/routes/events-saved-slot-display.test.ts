import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(id => id === 'account-a') }));
import events from './events.js';

it('下書きの開催回を保存して同じSQLiteから日時・定員と管理一覧を読み直す', async () => {
  const { db, raw } = createTestD1({ now: () => new Date('2026-11-01T03:00:00Z') });
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'owner-a', name: 'Owner', role: 'owner', readOnly: false }); await next(); });
  app.route('/', events);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('外部通信は実行しません'); });
  const evidence: unknown[] = [];
  try {
    raw.exec("INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('account-a','channel-a','模擬アカウント','mock-token','mock-secret')");
    const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db });
    for (const scenario of [
      { name: '未来の保存回', starts_at: '2099-11-02T05:00:00.000Z', ends_at: '2099-11-02T06:00:00.000Z', capacity: 17 },
      { name: '過去の保存回', starts_at: '2000-11-02T05:00:00.000Z', ends_at: '2000-11-02T06:00:00.000Z', capacity: 23 },
    ]) {
      const create = await request('/api/events/admin/events?account_id=account-a', 'POST', { name: scenario.name, is_published: 0 });
      expect(create.status).toBe(201);
      const created = await create.json() as { id: string; is_published: number };
      expect(created.is_published).toBe(0);
      const input = { starts_at: scenario.starts_at, ends_at: scenario.ends_at, capacity: scenario.capacity, client_key: `first-slot:${created.id}` };
      const saved = await request(`/api/events/admin/events/${created.id}/slots?account_id=account-a`, 'POST', { slots: [input] });
      expect(saved.status).toBe(201);
      const saveResult = await saved.json() as { items: Array<{ id: string; starts_at: string; ends_at: string; capacity: number }> };
      expect(saveResult.items).toHaveLength(1);
      const read = await request(`/api/events/admin/events/${created.id}/slots?account_id=account-a`);
      const readResult = await read.json() as { items: Array<{ id: string; starts_at: string; ends_at: string; capacity: number }> };
      expect(read.status).toBe(200);
      expect(readResult.items[0]).toMatchObject({ starts_at: scenario.starts_at, ends_at: scenario.ends_at, capacity: scenario.capacity });
      const list = await request('/api/events/admin/events?account_id=account-a');
      expect(list.status).toBe(200);
      const listResult = await list.json() as { items: Array<{ id: string; name: string; next_slot_starts_at: string | null; total_capacity: number | null; is_published: number; latest_past_slot_starts_at: string | null }>; summary: unknown };
      const row = listResult.items.find(item => item.id === created.id)!;
      expect(row.total_capacity).toBe(scenario.capacity);
      expect(row.is_published).toBe(0);
      expect(row.next_slot_starts_at).toBe(scenario.name === '未来の保存回' ? scenario.starts_at : null);
      expect(row.latest_past_slot_starts_at).toBe(scenario.name === '過去の保存回' ? scenario.starts_at : null);
      evidence.push({ scenario, input, saveResult, readResult, listRow: row, summary: listResult.summary, persisted: raw.prepare('SELECT starts_at, ends_at, capacity, is_active FROM event_slots WHERE event_id=?').all(created.id) });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const directory = process.env.EVENT_SLOT_EVIDENCE_DIR;
    if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'saved-slot-responses.json'), JSON.stringify(evidence, null, 2)); }
  } finally { fetchSpy.mockRestore(); raw.close(); }
});


function localCatalog() {
  const { db, raw } = createTestD1({ now: () => new Date('2026-11-01T03:00:00Z') });
  raw.exec("INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('account-a','channel-a','模擬アカウント','mock-token','mock-secret'),('account-b','channel-b','別の模擬アカウント','mock-token','mock-secret')");
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'owner-a', name: 'Owner', role: 'owner', readOnly: false }); await next(); });
  app.route('/', events);
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: db });
  const create = async (name: string) => {
    const response = await request('/api/events/admin/events?account_id=account-a', 'POST', { name, is_published: 0 });
    expect(response.status).toBe(201);
    return await response.json() as { id: string };
  };
  const slots = async (eventId: string, rows: Array<{ starts_at: string; ends_at: string; capacity: number; is_active?: number }>) => {
    const response = await request(`/api/events/admin/events/${eventId}/slots?account_id=account-a`, 'POST', { slots: rows });
    expect(response.status).toBe(201);
    return await response.json() as { items: Array<{ id: string }> };
  };
  const list = async () => {
    const response = await request('/api/events/admin/events?account_id=account-a');
    expect(response.status).toBe(200);
    return await response.json() as { items: Array<{ id: string; next_slot_starts_at: string | null; latest_past_slot_starts_at: string | null; total_capacity: number | null }>; summary: { upcoming_slots: number; upcoming_capacity: number } };
  };
  return { raw, request, create, slots, list };
}

it('過去と未来が混在しても次の回と定員を保ち、無効・削除済み・別イベントの日時を混ぜない', async () => {
  const fixture = localCatalog();
  try {
    const target = await fixture.create('集計対象');
    const input = [
      { starts_at: '2000-01-01T03:00:00.000Z', ends_at: '2000-01-01T04:00:00.000Z', capacity: 3 },
      { starts_at: '2001-01-01T03:00:00.000Z', ends_at: '2001-01-01T04:00:00.000Z', capacity: 4 },
      { starts_at: '2099-01-01T03:00:00.000Z', ends_at: '2099-01-01T04:00:00.000Z', capacity: 5 },
      { starts_at: '2100-01-01T03:00:00.000Z', ends_at: '2100-01-01T04:00:00.000Z', capacity: 5 },
      { starts_at: '2002-01-01T03:00:00.000Z', ends_at: '2002-01-01T04:00:00.000Z', capacity: 100, is_active: 0 },
      { starts_at: '2003-01-01T03:00:00.000Z', ends_at: '2003-01-01T04:00:00.000Z', capacity: 200 },
    ];
    const saved = await fixture.slots(target.id, input);
    fixture.raw.prepare('UPDATE event_slots SET deleted_at=? WHERE id=?').run('2026-10-01T00:00:00Z', saved.items[5].id);
    const other = await fixture.create('別イベント');
    await fixture.slots(other.id, [{ starts_at: '2005-01-01T03:00:00.000Z', ends_at: '2005-01-01T04:00:00.000Z', capacity: 999 }]);
    fixture.raw.exec("INSERT INTO events(id,line_account_id,name,is_published,lifecycle_status) VALUES('foreign-event','account-b','別アカウント',0,'draft'); INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity,is_active) VALUES('foreign-slot','foreign-event','2006-01-01T03:00:00.000Z','2006-01-01T04:00:00.000Z',999,1)");
    const result = await fixture.list();
    expect(result.items[0].id).toBe(target.id);
    expect(result.items.find(row => row.id === target.id)).toMatchObject({ next_slot_starts_at: input[2].starts_at, latest_past_slot_starts_at: input[1].starts_at, total_capacity: 17 });
    expect(result.items.some(row => row.id === 'foreign-event')).toBe(false);
    expect(result.summary).toMatchObject({ upcoming_slots: 0, upcoming_capacity: 0 });
    expect((await fixture.request('/api/events/admin/events?account_id=account-b')).status).toBe(403);
  } finally { fixture.raw.close(); }
});

it('開始が今と同じ回は次の回にだけ入れ、直前の回を過去日時にする', async () => {
  const fixture = localCatalog();
  try {
    const target = await fixture.create('境目の開催回');
    await fixture.slots(target.id, [
      { starts_at: '2026-11-01T02:59:59.999Z', ends_at: '2026-11-01T04:00:00.000Z', capacity: 4 },
      { starts_at: '2026-11-01T03:00:00.000Z', ends_at: '2026-11-01T04:00:00.000Z', capacity: 6 },
    ]);
    expect((await fixture.list()).items[0]).toMatchObject({ next_slot_starts_at: '2026-11-01T03:00:00.000Z', latest_past_slot_starts_at: '2026-11-01T02:59:59.999Z', total_capacity: 10 });
  } finally { fixture.raw.close(); }
});

it('枠がないイベントへ別の回を補わず、無効な枠だけでも両日時をnullに保つ', async () => {
  const fixture = localCatalog();
  try {
    const empty = await fixture.create('枠なし');
    const inactive = await fixture.create('停止した回だけ');
    await fixture.slots(inactive.id, [{ starts_at: '2001-01-01T03:00:00.000Z', ends_at: '2001-01-01T04:00:00.000Z', capacity: 12, is_active: 0 }]);
    const result = await fixture.list();
    for (const id of [empty.id, inactive.id]) expect(result.items.find(row => row.id === id)).toMatchObject({ next_slot_starts_at: null, latest_past_slot_starts_at: null, total_capacity: null });
  } finally { fixture.raw.close(); }
});

it('日時なしで保存した公開イベントは、その公開状態と空の日時を一覧から読み直す', async () => {
  const fixture = localCatalog();
  try {
    const created = await fixture.request('/api/events/admin/events?account_id=account-a', 'POST', { name: '日時なし公開', is_published: 1 });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const result = await fixture.list();
    expect(result.items.find(row => row.id === id)).toMatchObject({ is_published: 1, lifecycle_status: 'published', next_slot_starts_at: null, latest_past_slot_starts_at: null });
  } finally { fixture.raw.close(); }
});
