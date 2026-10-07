import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendMigrations } from './friend-migrations.js';
import { friendFields } from './friend-fields.js';
import { previewFriendBulkRun } from '../services/friend-bulk-runs.js';

let sqlite: SqliteD1;
let app: Hono<Env>;
function request(path: string, method = 'GET', body?: unknown, key?: string) {
  return app.request(path, {
    method,
    headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: sqlite.db } as Env['Bindings']);
}
beforeEach(() => {
  sqlite = createTestD1();
  sqlite.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('acc-1', 'channel-1', '本店', 'token', 'secret', ?)`).run(DEFAULT_TENANT_ID);
  sqlite.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
    VALUES ('owner', '統括', 'owner', 'owner-key', ?, 'all')`).run(DEFAULT_TENANT_ID);
  insertFriend(sqlite.raw, 'f1', { line_account_id: 'acc-1' });
  sqlite.raw.exec("INSERT INTO friend_fields (id, name, field_key, type, type_v6) VALUES ('source', '元の時刻', 'old_time', 'text', 'text');");
  app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friendFields);
  app.route('/', friendMigrations);
});
afterEach(() => sqlite.raw.close());

async function create(defaultValue: unknown = '09:30') {
  return request('/api/friend-fields?lineAccountId=acc-1', 'POST', {
    name: '来店時刻', fieldKey: 'visit_time', type: 'time', defaultValue,
  }, 'clock-field');
}

describe('時刻型の管理API', () => {
  test('作成・既定値・単票保存・読み直し・一括保存を通す', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    const field = (await created.json() as { data: { id: string; type: string; defaultValue: string } }).data;
    expect(field).toMatchObject({ type: 'time', defaultValue: '09:30' });
    expect((await create()).status).toBe(200);
    const saved = await request('/api/friends/f1/fields', 'PUT', { values: { [field.id]: ' 23:59 ' } });
    expect(saved.status).toBe(200);
    const read = await request('/api/friends/f1/fields');
    expect(read.status).toBe(200);
    expect((await read.json() as { data: { items: unknown[] } }).data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: field.id, type: 'time', value: '23:59' }),
    ]));
    const bulk = await request('/api/friend-fields/bulk', 'POST', {
      lineAccountId: 'acc-1', fieldId: field.id, friendIds: ['f1'], value: '00:00',
    });
    expect(bulk.status).toBe(200);
    expect(sqlite.raw.prepare('SELECT value FROM friend_field_values WHERE field_id = ?').get(field.id)).toEqual({ value: '00:00' });
  });

  test.each(['24:00', '12:60', '9:30', 930])('不正な既定値%jは項目を作らない', async (value) => {
    expect((await create(value)).status).toBe(422);
    expect(sqlite.raw.prepare("SELECT COUNT(*) AS count FROM friend_fields WHERE field_key = 'visit_time'").get()).toEqual({ count: 0 });
  });

  test('不正値は単票・一括とも保存しない', async () => {
    const created = await create();
    const { data: field } = await created.json() as { data: { id: string } };
    expect((await request('/api/friends/f1/fields', 'PUT', { values: { [field.id]: '24:00' } })).status).toBe(422);
    expect((await request('/api/friend-fields/bulk', 'POST', { lineAccountId: 'acc-1', fieldId: field.id, friendIds: ['f1'], value: '23:60' })).status).toBe(422);
    expect(sqlite.raw.prepare('SELECT COUNT(*) AS count FROM friend_field_values').get()).toEqual({ count: 0 });
  });

  test('友だち一括操作でも時刻を文字列として素通しせず検査する', async () => {
    const created = await create();
    const { data: field } = await created.json() as { data: { id: string } };
    const staff = { id: 'owner', name: '統括', role: 'owner' as const, readOnly: false, tenantId: DEFAULT_TENANT_ID };
    const selection = { kind: 'explicit' as const, friendIds: ['f1'] };
    await expect(previewFriendBulkRun(sqlite.db, staff, selection, {
      kind: 'set_friend_fields', values: { [field.id]: '24:00' },
    })).rejects.toMatchObject({ code: 'friend_field_value_invalid', status: 422 });
    const valid = await previewFriendBulkRun(sqlite.db, staff, selection, {
      kind: 'set_friend_fields', values: { [field.id]: '09:30' },
    });
    expect(valid.preview).toMatchObject({ targetCount: 1 });
  });

  test('種類の移行確認でも保存時と同じ時刻検査を使う', async () => {
    sqlite.raw.exec("INSERT INTO friend_field_values (friend_id, field_id, value) VALUES ('f1', 'source', '24:00');");
    const invalid = await request('/api/friend-fields/source/migration-preview?lineAccountId=acc-1', 'POST', { targetType: 'time' });
    expect(invalid.status).toBe(200);
    expect((await invalid.json() as { data: unknown }).data).toMatchObject({ summary: { total: 1, convertible: 0, review: 1 } });
    sqlite.raw.exec("UPDATE friend_field_values SET value = '23:59';");
    const valid = await request('/api/friend-fields/source/migration-preview?lineAccountId=acc-1', 'POST', { targetType: 'time' });
    expect(valid.status).toBe(200);
    expect((await valid.json() as { data: unknown }).data).toMatchObject({ summary: { total: 1, convertible: 1, review: 0 } });
  });
});


describe('時刻のCSV入出力', () => {
  test('取り込み確認・反映・書き出しをHH:MMのまま往復する', async () => {
    await create();
    const preview = await request('/api/friends/imports', 'POST', {
      accountId: 'acc-1', sourceFilename: 'clock.csv', sourceChecksum: 'clock-ok',
      rows: [{ lineUid: 'U_clock', displayName: '時刻の読者', friendFields: { visit_time: '09:30' } }],
    });
    expect(preview.status).toBe(201);
    const result = await preview.json() as { data: { id: string; result: { summary: { add: number } } } };
    expect(result.data.result.summary.add).toBe(1);
    expect((await request(`/api/friends/imports/${result.data.id}/execute`, 'POST', {})).status).toBe(200);
    expect(sqlite.raw.prepare('SELECT value FROM friend_field_values').get()).toEqual({ value: '09:30' });
    const exported = await request('/api/friends/exports', 'POST', { accountId: 'acc-1', columns: ['basic', 'friend_fields'], encoding: 'utf-8' });
    expect(exported.status).toBe(201);
    const { data: { downloadUrl } } = await exported.json() as { data: { downloadUrl: string } };
    const download = await request(downloadUrl);
    expect(download.status).toBe(200);
    const csv = await download.text();
    expect(csv).toContain('visit_time');
    expect(csv).toMatch(/U_clock[^\r\n]*09:30/);
    expect(csv).not.toContain('T09:30');
  });

  test.each(['9:30', '24:00', '12:60', '12:30:00'])('CSVの不正時刻%sを行ごとのエラーにし反映しない', async (value) => {
    await create();
    const preview = await request('/api/friends/imports', 'POST', {
      accountId: 'acc-1', sourceFilename: 'clock.csv', sourceChecksum: `bad-${value}`,
      rows: [{ lineUid: 'U_ok', friendFields: { visit_time: '23:59' } }, { lineUid: 'U_bad', friendFields: { visit_time: value } }],
    });
    expect(preview.status).toBe(201);
    const { data } = await preview.json() as { data: { id: string; result: { rows: unknown[]; summary: unknown } } };
    expect(data.result.summary).toMatchObject({ add: 1, error: 1 });
    expect(data.result.rows[1]).toMatchObject({ lineUid: 'U_bad', kind: 'error', reason: expect.stringContaining('HH:mm') });
    expect((await request(`/api/friends/imports/${data.id}/execute`, 'POST', {})).status).toBe(422);
    expect(sqlite.raw.prepare('SELECT COUNT(*) AS count FROM friend_field_values').get()).toEqual({ count: 0 });
  });
});
