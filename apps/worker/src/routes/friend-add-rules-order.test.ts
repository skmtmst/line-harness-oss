import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friendAddRules } from './friend-add-rules.js';

/*
 * F8: 友だち追加時の配信の並べ替えを、まとめて並べ替える口
 * PUT /api/friend-add-rules/order で行う。対象IDの全部・所属・区分・
 * expectedVersion の4点を厳密に見て、1つでも合わなければ 409 で止める。
 */
const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function buildApp(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', owner);
    await next();
  });
  instance.route('/', friendAddRules);
  return {
    instance,
    bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'],
  };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function seedBase(raw: SqliteD1['raw']): void {
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1'),
            ('account-2', 'channel-2', '店舗2', '', '', 1, 'tenant-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id)
     VALUES ('owner-1', 'オーナー', 'owner', 'owner-key', 'tenant-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO friend_add_rules
      (id, line_account_id, friend_kind, name, priority, status, created_at, updated_at)
     VALUES ('rule-1', 'account-1', 'first_time', '紹介QR', 1, 'published',
             '2026-10-01T09:00:00+09:00', '2026-10-01T09:00:00+09:00'),
            ('rule-2', 'account-1', 'first_time', '紹介キャンペーン', 2, 'published',
             '2026-10-01T09:01:00+09:00', '2026-10-01T09:01:00+09:00')`,
  ).run();
}

async function getOrderVersion(
  target: ReturnType<typeof buildApp>,
): Promise<number> {
  const list = await target.instance.request(
    '/api/friend-add-rules?account_id=account-1&kind=first_time',
    {},
    target.bindings,
  );
  expect(list.status).toBe(200);
  const body = (await list.json()) as { data: { orderVersion: number } };
  return body.data.orderVersion;
}

describe('F8: PUT /api/friend-add-rules/order の厳密なCAS', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  it('版が合えば並べ替えて新しい版を返す', async () => {
    const target = buildApp(testDb.db);
    const version = await getOrderVersion(target);

    const res = await target.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', {
        accountId: 'account-1',
        friendKind: 'first_time',
        ids: ['rule-2', 'rule-1'],
        expectedVersion: version,
      }),
      target.bindings,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { updated: number; orderVersion: number } };
    expect(body.data.updated).toBe(2);
    expect(body.data.orderVersion).toBeGreaterThan(version);

    // 順が実際に入れ替わっている。
    const rows = testDb.raw.prepare(
      `SELECT id FROM friend_add_rules
        WHERE line_account_id = 'account-1' AND friend_kind = 'first_time'
          AND is_unknown_route_fallback = 0 AND archived_at IS NULL
        ORDER BY priority ASC`,
    ).all() as { id: string }[];
    expect(rows.map((row) => row.id)).toEqual(['rule-2', 'rule-1']);
  });

  it('古い版では並べ替えず409で今の版を返す', async () => {
    const target = buildApp(testDb.db);
    const version = await getOrderVersion(target);

    // ほかの画面が先に並べ替える。
    const first = await target.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', {
        accountId: 'account-1',
        friendKind: 'first_time',
        ids: ['rule-2', 'rule-1'],
        expectedVersion: version,
      }),
      target.bindings,
    );
    expect(first.status).toBe(200);

    // 古い版のまま並べ替えようとすると止まる。
    const second = await target.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', {
        accountId: 'account-1',
        friendKind: 'first_time',
        ids: ['rule-1', 'rule-2'],
        expectedVersion: version,
      }),
      target.bindings,
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as {
      code?: string;
      data?: { currentVersion?: number };
    };
    expect(body.code).toBe('ORDER_VERSION_CONFLICT');
    expect(body.data?.currentVersion).toBeGreaterThan(version);
  });

  it('対象が足りない・余分なIDでは409で止める', async () => {
    const target = buildApp(testDb.db);
    const version = await getOrderVersion(target);

    for (const ids of [['rule-1'], ['rule-1', 'rule-2', 'rule-x']]) {
      const res = await target.instance.request(
        '/api/friend-add-rules/order',
        jsonRequest('PUT', { accountId: 'account-1', friendKind: 'first_time', ids, expectedVersion: version }),
        target.bindings,
      );
      expect(res.status).toBe(409);
    }

    // 重複IDは形式不良。
    const dup = await target.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', {
        accountId: 'account-1',
        friendKind: 'first_time',
        ids: ['rule-1', 'rule-1'],
        expectedVersion: version,
      }),
      target.bindings,
    );
    expect(dup.status).toBe(400);
  });

  it('版が無い・整数でないと400で止める', async () => {
    const target = buildApp(testDb.db);
    const version = await getOrderVersion(target);

    for (const expectedVersion of [undefined, null, '2', 1.5]) {
      const res = await target.instance.request(
        '/api/friend-add-rules/order',
        jsonRequest('PUT', {
          accountId: 'account-1',
          friendKind: 'first_time',
          ids: ['rule-1', 'rule-2'],
          expectedVersion,
        }),
        target.bindings,
      );
      expect(res.status).toBe(400);
    }
    expect(version).toBeGreaterThanOrEqual(0);
  });

  it('別アカウント・区分違いは受け付けない', async () => {
    const target = buildApp(testDb.db);
    const version = await getOrderVersion(target);
    const payload = {
      friendKind: 'first_time',
      ids: ['rule-1', 'rule-2'],
      expectedVersion: version,
    };

    // 別アカウントのIDでは並べ替えできない（所属の厳密さ）。
    const foreign = await target.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', { ...payload, accountId: 'account-2' }),
      target.bindings,
    );
    expect(foreign.status).toBe(409);

    // 区分が違う。
    const wrongKind = await target.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', { ...payload, accountId: 'account-1', friendKind: 'returning' }),
      target.bindings,
    );
    expect(wrongKind.status).toBe(409);
  });
});

/*
 * F8補修: 同じ版での2要求の割り込み。Aの版確認と書込のあいだにBが
 * 書き終えても、Aは409で止まり、Bの順を上書きしない（部分更新0）。
 * Aの書込文が走る直前にBのPUT全体を割り込ませて再現する。
 */
function hookOrderWrite(
  testDb: SqliteD1,
  onFire: () => Promise<void>,
): { db: D1Database; wasFired: () => boolean } {
  let fired = false;
  const inner = testDb.db as unknown as {
    prepare: (sql: string) => {
      bind: (...args: unknown[]) => { run: (...a: never[]) => Promise<unknown> } & Record<string, unknown>;
      sql: string;
    };
    batch: (statements: Array<{ sql?: string }>) => Promise<unknown[]>;
  };
  const isOrderWrite = (sql: string): boolean =>
    sql.includes('UPDATE friend_add_rules') && sql.includes('priority');
  const db = {
    prepare: (sql: string) => {
      const stmt = inner.prepare(sql);
      return {
        ...stmt,
        bind: (...args: unknown[]) => {
          const bound = stmt.bind(...args) as {
            run: (...a: never[]) => Promise<unknown>;
          } & Record<string, unknown>;
          const through = { ...bound };
          const originalRun = bound.run.bind(bound);
          (through as Record<string, unknown>).run = async (...a: never[]) => {
            if (!fired && isOrderWrite(sql)) {
              fired = true;
              await onFire();
            }
            return originalRun(...a);
          };
          return through;
        },
      };
    },
    batch: async (statements: Array<{ sql?: string }>) => {
      const sqls = statements.map((item) => item?.sql ?? '');
      if (!fired && sqls.some(isOrderWrite)) {
        fired = true;
        await onFire();
      }
      return inner.batch(statements);
    },
  } as unknown as D1Database;
  return { db, wasFired: () => fired };
}

describe('F8補修: 同版2要求の原子的CAS', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb.raw);
  });

  function scopeState(): { order: string[]; version: number } {
    const rows = testDb.raw.prepare(
      `SELECT id FROM friend_add_rules
        WHERE line_account_id = 'account-1' AND friend_kind = 'first_time'
          AND is_unknown_route_fallback = 0 AND archived_at IS NULL
        ORDER BY priority ASC`,
    ).all() as { id: string }[];
    const version = testDb.raw.prepare(
      `SELECT COALESCE(SUM(lock_version), 0) AS version FROM friend_add_rules
        WHERE line_account_id = 'account-1' AND friend_kind = 'first_time'
          AND is_unknown_route_fallback = 0 AND archived_at IS NULL`,
    ).get() as { version: number };
    return { order: rows.map((row) => row.id), version: Number(version.version) };
  }

  it('割り込んだBが200、Aは409でBの順を壊さない', async () => {
    const plain = buildApp(testDb.db);
    const version = await getOrderVersion(plain);
    const { db: hookedDb, wasFired } = hookOrderWrite(testDb, async () => {
      // Aの書込直前にBが同じ版で書き終える。
      const rival = buildApp(testDb.db);
      const second = await rival.instance.request(
        '/api/friend-add-rules/order',
        jsonRequest('PUT', {
          accountId: 'account-1',
          friendKind: 'first_time',
          ids: ['rule-2', 'rule-1'],
          expectedVersion: version,
        }),
        rival.bindings,
      );
      expect(second.status).toBe(200);
    });

    const first = buildApp(hookedDb);
    const res = await first.instance.request(
      '/api/friend-add-rules/order',
      jsonRequest('PUT', {
        accountId: 'account-1',
        friendKind: 'first_time',
        ids: ['rule-1', 'rule-2'],
        expectedVersion: version,
      }),
      first.bindings,
    );
    // 割り込みが実際に起きたこと（空振りの合格にしない）。
    expect(wasFired()).toBe(true);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('ORDER_VERSION_CONFLICT');

    // Bの順のまま。Aの部分更新は無い（版はBの1回分だけ進む）。
    expect(scopeState()).toEqual({ order: ['rule-2', 'rule-1'], version: version + 2 });
  });
});
