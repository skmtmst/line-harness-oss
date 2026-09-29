import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import {
  createIntegrationApiToken,
  revokeIntegrationApiToken,
  rotateIntegrationApiToken,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';

/*
 * 公開APIトークンとタグ付与の後続（監査 R431〜R436）。
 * 実D1（better-sqlite3 + bootstrap.sql）で本物の route・DB関数を走らせる。
 * 外部通信はしない。event-bus だけは発火の引数を掴むための殻にする
 * （加点・旧自動化の二重実行を数える試験ではないため）。
 */

const fireEventMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('../services/event-bus.js', () => ({
  fireEvent: fireEventMock,
  logOutgoingMessage: vi.fn(async () => undefined),
}));

vi.mock('../lib/step-up.js', () => ({
  sensitiveStepUpSatisfied: vi.fn(async () => true),
  stepUpRequiredResponse: vi.fn((c: { json: (b: unknown, s: number) => Response }) =>
    c.json({ success: false, code: 'STEP_UP_REQUIRED' }, 401)),
}));

import { publicApi } from './public-api.js';
import { webhooks } from './webhooks.js';
import { scenarios } from './scenarios.js';

const NOW = '2026-09-28T12:00:00.000+09:00';

function seedBase(raw: SqliteD1['raw']): void {
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name, status) VALUES (?, '既定', 'active')`)
    .run(DEFAULT_TENANT_ID);
  for (const id of ['acc-a', 'acc-b']) {
    raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)`)
      .run(id, `channel-${id}`, `店舗${id}`, DEFAULT_TENANT_ID);
  }
  raw.prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id, created_at, updated_at)
    VALUES ('friend-a', 'U1', '友だちA', 'acc-a', ?, ?)`)
    .run(NOW, NOW);
  // acc-a のタグと、所属なしの共通タグ。
  raw.prepare(`INSERT INTO tags (id, name, color, line_account_id, manual_assignment_allowed, display_order, status)
    VALUES ('tag-a', 'Aタグ', '#3B82F6', 'acc-a', 1, 0, 'active')`).run();
  raw.prepare(`INSERT INTO tags (id, name, color, line_account_id, manual_assignment_allowed, display_order, status)
    VALUES ('tag-common', '共通タグ', '#3B82F6', NULL, 1, 1, 'active')`).run();
  // 両アカウントに同じ共通タグで始まる公開済みシナリオ。
  for (const [scenarioId, accountId] of [['sc-a1', 'acc-a'], ['sc-b1', 'acc-b']] as const) {
    raw.prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id, current_published_version_id, created_at, updated_at)
      VALUES (?, ?, 'manual', 1, ?, ?, ?, ?)`)
      .run(scenarioId, `シナリオ${scenarioId}`, accountId, `sv-${scenarioId}`, NOW, NOW);
    raw.prepare(`INSERT INTO scenario_versions (id, scenario_id, version_number, status, steps_snapshot, actions_snapshot, published_at, created_at, updated_at)
      VALUES (?, ?, 1, 'published', '[{"step_order":0,"messageContent":"こんにちは"}]', '[]', ?, ?, ?)`)
      .run(`sv-${scenarioId}`, scenarioId, NOW, NOW, NOW);
    raw.prepare(`INSERT INTO scenario_triggers (id, scenario_id, kind, tag_id)
      VALUES (?, ?, 'tag_added', 'tag-common')`)
      .run(`trg-${scenarioId}`, scenarioId);
  }
}

function setExternalIntegrations(raw: SqliteD1['raw'], accountId: string, enabled: boolean): void {
  raw.prepare(`INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
    VALUES (?, ?, 'feature.external_integrations', ?, ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value`)
    .run(`setting-ext-${accountId}`, accountId, JSON.stringify({ enabled }), NOW, NOW);
}

function publicApp(db: D1Database): Hono<Env> {
  const app = new Hono<Env>();
  app.route('/', publicApi);
  return app;
}

async function postTag(
  app: Hono<Env>,
  db: D1Database,
  token: string,
  friendId: string,
  tagId: string,
): Promise<{ status: number; body: any }> {
  const res = await app.request(
    `/api/public/v1/friends/${friendId}/tags`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tagId }),
    },
    { DB: db } as unknown as Env,
  );
  return { status: res.status, body: await res.json() };
}

function countEnrollments(raw: SqliteD1['raw'], friendId: string): Array<{ scenario_id: string }> {
  return raw.prepare(`SELECT scenario_id FROM friend_scenarios WHERE friend_id = ? ORDER BY scenario_id`)
    .all(friendId) as unknown as Array<{ scenario_id: string }>;
}

beforeEach(() => {
  fireEventMock.mockClear();
});

describe('R432 外部連携オフ中の公開API', () => {
  test('書き込みは403で止まりタグは増えない。読み取りは仕様どおり使える', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    setExternalIntegrations(raw, 'acc-a', false);
    const { token } = await createIntegrationApiToken(db, {
      lineAccountId: 'acc-a',
      name: '監査用',
      scopes: ['tags:read', 'tags:write'],
      createdBy: 'owner-1',
    });
    const app = publicApp(db);

    const write = await postTag(app, db, token, 'friend-a', 'tag-a');
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('FEATURE_DISABLED');
    const tags = raw.prepare(`SELECT * FROM friend_tags WHERE friend_id = 'friend-a'`).all();
    expect(tags).toHaveLength(0);

    const read = await app.request(
      '/api/public/v1/tags',
      { headers: { authorization: `Bearer ${token}` } },
      { DB: db } as unknown as Env,
    );
    expect(read.status).toBe(200);
    raw.close();
  });

  test('オン中は従来どおり書ける', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { token } = await createIntegrationApiToken(db, {
      lineAccountId: 'acc-a',
      name: '監査用',
      scopes: ['tags:write'],
      createdBy: 'owner-1',
    });
    const write = await postTag(publicApp(db), db, token, 'friend-a', 'tag-a');
    expect(write.status).toBe(201);
    raw.close();
  });
});

describe('R435 別アカウントのシナリオへ登録しない', () => {
  test('共通タグでも自アカウントの公開済みだけが始まる', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { token } = await createIntegrationApiToken(db, {
      lineAccountId: 'acc-a',
      name: '監査用',
      scopes: ['tags:read', 'tags:write'],
      createdBy: 'owner-1',
    });
    const first = await postTag(publicApp(db), db, token, 'friend-a', 'tag-common');
    expect(first.status).toBe(201);
    expect(countEnrollments(raw, 'friend-a').map((r) => r.scenario_id)).toEqual(['sc-a1']);
    // 同じ要求の再送でも他組織の購読は増えない。
    const retry = await postTag(publicApp(db), db, token, 'friend-a', 'tag-common');
    expect(retry.status).toBe(200);
    expect(countEnrollments(raw, 'friend-a').map((r) => r.scenario_id)).toEqual(['sc-a1']);
    raw.close();
  });

  test('開始条件に別アカウントのタグは付けられない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', {
        id: 'owner-1', name: '統括', role: 'owner', readOnly: false,
        tenantId: DEFAULT_TENANT_ID, assignedLineAccountId: null,
      });
      await next();
    });
    app.route('/', scenarios);
    const env = { DB: db } as unknown as Env;
    // acc-b のシナリオに acc-a 専用タグは付けられない。
    const foreign = await app.request('/api/scenarios/sc-b1/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'tag_added', tagId: 'tag-a' }),
    }, env);
    expect(foreign.status).toBe(400);
    // 自アカウントのタグと共通タグは付けられる。
    const own = await app.request('/api/scenarios/sc-b1/triggers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'tag_added', tagId: 'tag-common' }),
    }, env);
    expect(own.status).toBe(200);
    raw.close();
  });
});

describe('R433 同じ要求の再送で不足分だけ回復する', () => {
  test('2本目で落ちても再送で2本そろう。二重にはならない', async () => {
    const t = createTestD1();
    seedBase(t.raw);
    // acc-a に2本目を追加。
    t.raw.prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id, current_published_version_id, created_at, updated_at)
      VALUES ('sc-a2', 'シナリオA2', 'manual', 1, 'acc-a', 'sv-sc-a2', ?, ?)`)
      .run(NOW, NOW);
    t.raw.prepare(`INSERT INTO scenario_versions (id, scenario_id, version_number, status, steps_snapshot, actions_snapshot, published_at, created_at, updated_at)
      VALUES ('sv-sc-a2', 'sc-a2', 1, 'published', '[{"step_order":0,"messageContent":"やあ"}]', '[]', ?, ?, ?)`)
      .run(NOW, NOW, NOW);
    t.raw.prepare(`INSERT INTO scenario_triggers (id, scenario_id, kind, tag_id)
      VALUES ('trg-sc-a2', 'sc-a2', 'tag_added', 'tag-common')`).run();
    const { token } = await createIntegrationApiToken(t.db, {
      lineAccountId: 'acc-a',
      name: '監査用',
      scopes: ['tags:write'],
      createdBy: 'owner-1',
    });

    // 2件目の購読保存だけ落とす（1本目は成功済み・イベント未発火の形）。
    let calls = 0;
    const flaky = {
      prepare: (sql: string) => {
        const inner = (t.db as unknown as { prepare: (s: string) => any }).prepare(sql);
        return {
          ...inner,
          bind: (...args: unknown[]) => {
            const bound = inner.bind(...args);
            if (!/INSERT\s+OR\s+IGNORE\s+INTO\s+friend_scenarios/i.test(sql)) return bound;
            return {
              ...bound,
              run: async (...runArgs: unknown[]) => {
                calls += 1;
                if (calls === 2) throw new Error('injected second-enrollment failure');
                return bound.run(...runArgs);
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const failed = await postTag(publicApp(flaky), flaky, token, 'friend-a', 'tag-common');
    expect(failed.status).toBe(500);

    // 障害を外して同じ要求を再送。不足分だけが一度完成する。
    const app = publicApp(t.db);
    const retry = await postTag(app, t.db, token, 'friend-a', 'tag-common');
    expect(retry.status).toBe(200);
    expect(retry.body.data.added).toBe(false);
    expect(countEnrollments(t.raw, 'friend-a').map((r) => r.scenario_id))
      .toEqual(['sc-a1', 'sc-a2']);
    // もう一度送っても増えない。
    const again = await postTag(app, t.db, token, 'friend-a', 'tag-common');
    expect(again.status).toBe(200);
    expect(countEnrollments(t.raw, 'friend-a')).toHaveLength(2);
    t.raw.close();
  });
});

describe('R436 タグ付与から公開版オートメーションへ安定IDで渡す', () => {
  test('初回は安定した発生元IDと所属付きで1回だけ発火し、再送では増やさない', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { token } = await createIntegrationApiToken(db, {
      lineAccountId: 'acc-a',
      name: '監査用',
      scopes: ['tags:write'],
      createdBy: 'owner-1',
    });
    const app = publicApp(db);
    const first = await postTag(app, db, token, 'friend-a', 'tag-a');
    expect(first.status).toBe(201);
    expect(fireEventMock).toHaveBeenCalledTimes(1);
    const call = fireEventMock.mock.calls[0] as unknown[];
    const payload = call[2] as Record<string, unknown>;
    expect(payload.friendId).toBe('friend-a');
    // V6公開版の受け口が求める3点（発生元ID・所属・時刻）がそろう。
    expect(typeof payload.sourceEventId).toBe('string');
    expect((payload.sourceEventId as string).length).toBeGreaterThan(0);
    expect(call[4]).toBe('acc-a');
    expect(typeof payload.occurredAt).toBe('string');

    // 再送は発火も購読も増やさない。
    const retry = await postTag(app, db, token, 'friend-a', 'tag-a');
    expect(retry.status).toBe(200);
    expect(fireEventMock).toHaveBeenCalledTimes(1);
    raw.close();
  });
});

describe('R431 同時再発行は1本だけ成功する', () => {
  async function issue(db: D1Database): Promise<{ id: string }> {
    const { row } = await createIntegrationApiToken(db, {
      lineAccountId: 'acc-a',
      name: '監査用',
      scopes: ['tags:read'],
      createdBy: 'owner-1',
    });
    return { id: row.id };
  }

  /** 旧行の読みと失効のあいだへ割り込む殻。監査と同じ await 境界の gate。 */
  function gatedBetweenReadAndRevoke(
    db: D1Database,
    onRevoke: () => Promise<void>,
  ): D1Database {
    return {
      prepare: (sql: string) => {
        const inner = (db as unknown as { prepare: (s: string) => any }).prepare(sql);
        const isRevoke = /UPDATE\s+integration_api_tokens/i.test(sql)
          && /revoked_at/i.test(sql);
        if (!isRevoke) return inner;
        return {
          ...inner,
          bind: (...args: unknown[]) => {
            const bound = inner.bind(...args);
            return {
              ...bound,
              run: async (...runArgs: unknown[]) => {
                await onRevoke();
                return bound.run(...runArgs);
              },
            };
          },
        };
      },
    } as unknown as D1Database;
  }

  function validSuccessors(raw: SqliteD1['raw'], oldId: string): Array<{ id: string }> {
    return raw.prepare(`SELECT id FROM integration_api_tokens
      WHERE rotated_from_id = ? AND revoked_at IS NULL`).all(oldId) as unknown as Array<{ id: string }>;
  }

  test('同じ旧IDの並行rotateは最大1件だけ成功し、有効な後継は1本', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { id } = await issue(db);

    let secondResult: { status: string } | undefined;
    const gated = gatedBetweenReadAndRevoke(db, async () => {
      // 1本目が失効UPDATEの直前で待っているあいだに2本目を通す。
      secondResult = await rotateIntegrationApiToken(db, id, 'acc-a', 'owner-2');
    });
    const firstResult = await rotateIntegrationApiToken(gated, id, 'acc-a', 'owner-1');

    const okCount = [firstResult, secondResult].filter((r) => r?.status === 'ok').length;
    expect(okCount).toBe(1);
    expect(validSuccessors(raw, id)).toHaveLength(1);
    raw.close();
  });

  test('失効が先に確定したら古い読み取りのrotateは作らず競合を返す', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { id } = await issue(db);

    const gated = gatedBetweenReadAndRevoke(db, async () => {
      // 旧行を読んだあと・失効させる前に、別の要求が失効を確定させる。
      expect(await revokeIntegrationApiToken(db, id, 'acc-a', 'owner-2')).toBe(true);
    });
    const staleResult = await rotateIntegrationApiToken(gated, id, 'acc-a', 'owner-1');

    expect(staleResult.status).toBe('conflict');
    expect(validSuccessors(raw, id)).toHaveLength(0);
    raw.close();
  });

  test('通常の再発行は旧が使えず新が使える。旧IDの再rotateは404', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { id } = await issue(db);
    const rotated = await rotateIntegrationApiToken(db, id, 'acc-a', 'owner-1');
    expect(rotated.status).toBe('ok');
    // 旧IDではもう再発行できない。
    expect((await rotateIntegrationApiToken(db, id, 'acc-a', 'owner-1')).status).toBe('not_found');
    expect(validSuccessors(raw, id)).toHaveLength(1);
    raw.close();
  });

  test('競合した再発行の口は409で現在の状態を返す', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { id } = await issue(db);

    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', {
        id: 'owner-1', name: '統括', role: 'owner', readOnly: false,
        tenantId: DEFAULT_TENANT_ID, assignedLineAccountId: null,
      });
      await next();
    });
    app.route('/', webhooks);
    const envFor = (database: D1Database): Env => ({ DB: database }) as unknown as Env;
    const rotateReq = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    } as RequestInit;
    const path = `/api/webhooks/api-tokens/${id}/rotate?lineAccountId=acc-a`;

    // 口を叩いている最中（旧行の読みと失効のあいだ）に、別の要求が
    // 先に再発行を確定させる。待っていた側は409で現在の状態を受け取る。
    const gated = gatedBetweenReadAndRevoke(db, async () => {
      expect((await rotateIntegrationApiToken(db, id, 'acc-a', 'owner-2')).status).toBe('ok');
    });
    const res = await app.request(path, rotateReq, envFor(gated));
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.code).toBe('TOKEN_ROTATE_CONFLICT');
    // 有効な後継は先に確定した1本だけ。
    expect(validSuccessors(raw, id)).toHaveLength(1);
    raw.close();
  });

  test('旧IDの再rotateは404（通常の逐次操作）', async () => {
    const { db, raw } = createTestD1();
    seedBase(raw);
    const { id } = await issue(db);
    expect((await rotateIntegrationApiToken(db, id, 'acc-a', 'owner-1')).status).toBe('ok');

    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', {
        id: 'owner-1', name: '統括', role: 'owner', readOnly: false,
        tenantId: DEFAULT_TENANT_ID, assignedLineAccountId: null,
      });
      await next();
    });
    app.route('/', webhooks);
    const res = await app.request(
      `/api/webhooks/api-tokens/${id}/rotate?lineAccountId=acc-a`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { DB: db } as unknown as Env,
    );
    expect(res.status).toBe(404);
    raw.close();
  });
});
