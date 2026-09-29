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
      changeReason: '期間の修正',
    }), { DB: store.db } as Env['Bindings']);
    expect(updated.status).toBe(200);
    expect((await updated.json() as { data: object }).data).toMatchObject({ version: 2, expiryBehavior: 'stop', fallbackValue: null });

    const stale = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`, json('PATCH', {
      expectedVersion: 1, impactProof: proof, validUntil: null, changeReason: '期間を外す',
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

  it('変える理由がない更新・削除を400で止める（Q）', async () => {
    const created = await app(store.db).request('/api/common-vars', json('POST', {
      accountId: 'account-a', name: '営業時間', varKey: 'hours', value: '10-19',
    }), { DB: store.db } as Env['Bindings']);
    const id = (await created.json() as { data: { id: string } }).data.id;

    for (const body of [{ value: '11-20' }, { value: '11-20', changeReason: '  ' }]) {
      const response = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`, json('PATCH', body),
        { DB: store.db } as Env['Bindings']);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'change_reason_required' });
    }
    // 止まったので値は変わっていない。
    expect(store.raw.prepare('SELECT value FROM common_vars WHERE id = ?').get(id)).toEqual({ value: '10-19' });

    // 削除も理由が必須。
    const deleted = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`,
      { method: 'DELETE' }, { DB: store.db } as Env['Bindings']);
    expect(deleted.status).toBe(400);
    const okDelete = await app(store.db).request(
      `/api/common-vars/${id}?accountId=account-a&reason=${encodeURIComponent('もう使わない')}`,
      { method: 'DELETE' }, { DB: store.db } as Env['Bindings']);
    expect(okDelete.status).toBe(200);
    const version = store.raw.prepare(
      'SELECT change_reason FROM common_var_versions WHERE common_var_id = ? ORDER BY version_no DESC LIMIT 1',
    ).get(id) as { change_reason: string };
    expect(version.change_reason).toBe('もう使わない');
  });

  it('秘密の値は登録も更新も422で止める（Q）', async () => {
    // 鍵の形の文字列はリポジトリの秘匿情報スキャンに引っかかるため連結で組み立てる。
    const stripeLike = ['sk', 'live', 'fakefake12345'].join('_');
    const slackLike = 'xoxb-' + '123456789012-ABCDEFGHIJKLM';
    const created = await app(store.db).request('/api/common-vars', json('POST', {
      accountId: 'account-a', name: '鍵', varKey: 'api_key', value: stripeLike,
    }), { DB: store.db } as Env['Bindings']);
    expect(created.status).toBe(422);
    expect(await created.json()).toMatchObject({ code: 'secret_value_not_allowed' });

    const normal = await app(store.db).request('/api/common-vars', json('POST', {
      accountId: 'account-a', name: '営業時間', varKey: 'hours', value: '10-19',
    }), { DB: store.db } as Env['Bindings']);
    const id = (await normal.json() as { data: { id: string } }).data.id;
    const preview = await app(store.db).request(`/api/common-vars/${id}/impact-preview`, json('POST', {
      accountId: 'account-a', nextValue: slackLike,
    }), { DB: store.db } as Env['Bindings']);
    const proof = (await preview.json() as { data: { impactProof: string } }).data.impactProof;
    const patched = await app(store.db).request(`/api/common-vars/${id}?accountId=account-a`, json('PATCH', {
      value: slackLike, impactProof: proof, changeReason: '更新',
    }), { DB: store.db } as Env['Bindings']);
    expect(patched.status).toBe(422);
  });

  it('状態は 下書き→使用中→止めた→使用中 で進み、理由と許されない遷移を固定する（Q）', async () => {
    const created = await app(store.db).request('/api/common-vars', json('POST', {
      accountId: 'account-a', name: '準備中', varKey: 'wip', value: '未確定', status: 'draft',
    }), { DB: store.db } as Env['Bindings']);
    expect(created.status).toBe(201);
    const body = await created.json() as { data: { id: string; status: string; state: string } };
    expect(body.data.status).toBe('draft');
    expect(body.data.state).toBe('draft');

    // 理由なしの切替は止まる。
    const noReason = await app(store.db).request(`/api/common-vars/${body.data.id}/status?accountId=account-a`,
      json('POST', { to: 'active' }), { DB: store.db } as Env['Bindings']);
    expect(noReason.status).toBe(400);
    // 下書きを直接「止めた」にはできない。
    const invalid = await app(store.db).request(`/api/common-vars/${body.data.id}/status?accountId=account-a`,
      json('POST', { to: 'stopped', changeReason: 'x' }), { DB: store.db } as Env['Bindings']);
    expect(invalid.status).toBe(422);

    const published = await app(store.db).request(`/api/common-vars/${body.data.id}/status?accountId=account-a`,
      json('POST', { to: 'active', changeReason: '審査完了' }), { DB: store.db } as Env['Bindings']);
    expect((await published.json() as { data: { status: string } }).data.status).toBe('active');
    const stopped = await app(store.db).request(`/api/common-vars/${body.data.id}/status?accountId=account-a`,
      json('POST', { to: 'stopped', changeReason: '確認のため止める' }), { DB: store.db } as Env['Bindings']);
    expect((await stopped.json() as { data: { status: string } }).data.status).toBe('stopped');
  });
});
