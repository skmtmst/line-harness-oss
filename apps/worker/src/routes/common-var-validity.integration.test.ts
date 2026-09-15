import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const accountAccess = vi.hoisted(() => ({ canAccessAllLineAccounts: vi.fn() }));
vi.mock('../services/account-access.js', () => accountAccess);

import { contents } from './contents.js';

function app(db: D1Database) {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  hono.route('/', contents);
  return hono;
}

function json(method: string, body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('共通情報の有効期間 API（実route + SQLite）', () => {
  let store: SqliteD1;

  beforeEach(() => {
    store = createTestD1();
    store.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-a', 'channel-a', 'A', 'token', 'secret'),
              ('account-b', 'channel-b', 'B', 'token', 'secret')`,
    ).run();
    accountAccess.canAccessAllLineAccounts.mockImplementation(async (_db, _staff, ids: string[]) =>
      ids.every((id) => id === 'account-a'));
  });

  it('作成・取得・更新で期間と代替値を保存し、版競合とaccount境界を維持する', async () => {
    const created = await app(store.db).request('/api/common-vars', json('POST', {
      accountId: 'account-a', name: '期間案内', varKey: 'period_notice', type: 'text', value: '開催中',
      validFrom: '2026-09-16T10:00', validUntil: '2026-09-16T12:00',
      expiryBehavior: 'fallback', fallbackValue: '受付終了',
    }), { DB: store.db } as Env['Bindings']);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { data: { id: string; version: number; validFrom: string; validUntil: string } };
    expect(createdBody.data).toMatchObject({
      version: 1,
      validFrom: '2026-09-16T01:00:00.000Z',
      validUntil: '2026-09-16T03:00:00.000Z',
    });
    const id = createdBody.data.id;
    expect(store.raw.prepare(
      'SELECT valid_from, valid_until, fallback_value, expiry_behavior FROM common_vars WHERE id = ?',
    ).get(id)).toEqual({
      valid_from: '2026-09-16T01:00:00.000Z', valid_until: '2026-09-16T03:00:00.000Z',
      fallback_value: '受付終了', expiry_behavior: 'fallback',
    });

    const detail = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`, {}, { DB: store.db } as Env['Bindings']);
    expect(detail.status).toBe(200);
    expect((await detail.json() as { data: object }).data).toMatchObject({ fallbackValue: '受付終了', expiryBehavior: 'fallback' });

    const preview = await app(store.db).request(`/api/common-vars/${id}/impact-preview`, json('POST', {
      accountId: 'account-a', nextValue: '開催中', expectedVersion: 1,
    }), { DB: store.db } as Env['Bindings']);
    const proof = (await preview.json() as { data: { impactProof: string } }).data.impactProof;
    const updated = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`, json('PATCH', {
      expectedVersion: 1, impactProof: proof, validUntil: '2026-09-16T13:00', expiryBehavior: 'stop', fallbackValue: null,
    }), { DB: store.db } as Env['Bindings']);
    expect(updated.status).toBe(200);
    expect((await updated.json() as { data: object }).data).toMatchObject({ version: 2, expiryBehavior: 'stop', fallbackValue: null });

    const stale = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`, json('PATCH', {
      expectedVersion: 1, impactProof: proof, validUntil: null,
    }), { DB: store.db } as Env['Bindings']);
    expect(stale.status).toBe(409);
    const hidden = await app(store.db).request(`/api/common-vars/${id}?accountId=account-b`, {}, { DB: store.db } as Env['Bindings']);
    expect(hidden.status).toBe(404);
  });

  it('不正な期間と代替値なしを400で拒否して書き込まない', async () => {
    for (const input of [
      { validFrom: '2026-09-16T12:00', validUntil: '2026-09-16T12:00' },
      { validFrom: 'not-a-date' },
      { expiryBehavior: 'fallback', fallbackValue: '' },
    ]) {
      const response = await app(store.db).request('/api/common-vars', json('POST', {
        accountId: 'account-a', name: '不正', varKey: `bad_${Math.random().toString(16).slice(2)}`, value: 'x', ...input,
      }), { DB: store.db } as Env['Bindings']);
      expect(response.status).toBe(400);
    }
    expect(store.raw.prepare('SELECT COUNT(*) AS count FROM common_vars').get()).toEqual({ count: 0 });
  });
});
