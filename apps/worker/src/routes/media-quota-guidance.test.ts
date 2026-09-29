/**
 * N-198/N-204 (#796): 実route＋実SQLiteで容量の絞り込みと案内の元を確かめる。
 *
 * - nearLimitOnly=1 は契約上限への圧迫ファイルだけを返し、件数と一致する
 * - 79%・80%・100%で quota の state が normal・notice・full へ変わる
 * - 別口座の行・使用量を混ぜない。権限外の口座は404
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { contents } from './contents.js';

const GB = 1024 * 1024 * 1024;

function app() {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-1', name: 'o', role: 'owner', readOnly: false,
      tenantId: 'ten-1', permissionKeys: ['/contents'],
    });
    return next();
  });
  a.route('/', contents as never);
  return a;
}

function seed(t: SqliteD1) {
  t.raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('ten-1', 't1'), ('ten-2', 't2')`).run();
  for (const [id, tenant] of [['acc-a', 'ten-1'], ['acc-b', 'ten-2']] as const) {
    t.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES (?, ?, ?, 'tok', 'sec', ?)`,
    ).run(id, `ch-${id}`, id, tenant);
  }
  t.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
     VALUES ('owner-1', 'o', 'owner', 'k1', 'ten-1', 'all', '[]')`,
  ).run();
}

function insertMedia(t: SqliteD1, id: string, accountId: string, sizeBytes: number) {
  t.raw.prepare(
    `INSERT INTO media (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, created_at)
     VALUES (?, ?, 'video', ?, 'video/mp4', ?, ?, '2026-09-14T00:00:00+09:00')`,
  ).run(id, accountId, `${id}.mp4`, sizeBytes, `r2-${id}`);
}

describe('容量の絞り込みと案内の元（N-198/N-204・実route）', () => {
  let t: SqliteD1;
  beforeEach(() => {
    t = createTestD1();
    seed(t);
  });

  it('nearLimitOnly=1 は圧迫ファイルだけを件数一致で返す', async () => {
    insertMedia(t, 'm-big', 'acc-a', 500_000_000);
    insertMedia(t, 'm-small', 'acc-a', 1_000_000);
    const res = await app().request(
      '/api/media?accountId=acc-a&nearLimitOnly=1&limit=100', {},
      { DB: t.db } as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean; data: { items: { id: string }[]; total: number };
    };
    expect(body.data.items.map((m) => m.id)).toEqual(['m-big']);
    expect(body.data.total).toBe(1);
  });

  it('79%・80%・100%でquotaのstateが変わる', async () => {
    for (const [tag, usage, state] of [
      ['u79', 0.79, 'normal'],
      ['u80', 0.8, 'notice'],
      ['u100', 1.0, 'full'],
    ] as const) {
      t.raw.prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
         VALUES (?, ?, ?, 'tok', 'sec', 'ten-1')`,
      ).run(`acc-${tag}`, `ch-${tag}`, tag);
      insertMedia(t, `m-fill-${tag}`, `acc-${tag}`, Math.floor(10 * GB * usage));
      const res = await app().request(`/api/media/quota?accountId=acc-${tag}`, {}, { DB: t.db } as never);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { state: string; usageRate: number } };
      expect(body.data.state).toBe(state);
    }
  });

  it('別口座を混ぜず権限外は404', async () => {
    insertMedia(t, 'm-huge-b', 'acc-b', 5 * GB);
    const res = await app().request(
      '/api/media?accountId=acc-a&nearLimitOnly=1&limit=100', {},
      { DB: t.db } as never,
    );
    const body = (await res.json()) as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
    const quota = (await (await app().request('/api/media/quota?accountId=acc-a', {}, { DB: t.db } as never)).json()) as {
      success: boolean; data: { usageBytes: number; state: string };
    };
    expect(quota.data.usageBytes).toBe(0);
    expect(quota.data.state).toBe('normal');
    const ghost = await app().request('/api/media?accountId=acc-ghost', {}, { DB: t.db } as never);
    expect(ghost.status).toBe(404);
  });
});
