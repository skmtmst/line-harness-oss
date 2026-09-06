import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const db = {
  resolveLineCredential: vi.fn(async () => 'token'),
  hasFirstDeliveredMessage: vi.fn(async () => true),
};
vi.mock('@line-crm/db', () => db);

const accountAccess = {
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: ['account-1'],
    accounts: [{ id: 'account-1' }],
    ids: ['account-1'],
    canSeeUnassigned: false,
    isAccountScoped: false,
  })),
};
vi.mock('../services/account-access.js', () => accountAccess);

const webhook = {
  expectedWebhookUrl: vi.fn(() => 'https://worker.example.com/webhook'),
  fetchWebhookEndpoint: vi.fn(async () => ({ status: 'matched' as const })),
};
vi.mock('../lib/webhook-endpoint.js', () => webhook);

const state = {
  tags: 1,
  fields: 0,
  anyRule: true,
  scenarios: 1,
  linkedScenario: true,
  rules: [{
    is_unknown_route_fallback: 1,
    definition_snapshot: JSON.stringify({ scenarioId: 'scenario-1', actions: [] }),
  }],
};

const accountRows = [{
  id: 'account-1',
  is_active: 1,
  channel_access_token: 'token',
  channel_access_token_encrypted: null,
  channel_secret: 'secret',
  channel_secret_encrypted: null,
}];

function database(): D1Database {
  return {
    prepare(sql: string) {
      const make = (bindings: unknown[]) => ({
        bind: (...next: unknown[]) => make(next),
        async all<T>() {
          if (sql.includes('FROM line_accounts')) return { results: accountRows as T[] };
          if (sql.includes('FROM friend_add_rules r')) return { results: state.rules as T[] };
          return { results: [] as T[] };
        },
        async first<T>() {
          if (sql.includes('FROM tags')) return { c: state.tags } as T;
          if (sql.includes('FROM friend_fields')) return { c: state.fields } as T;
          if (sql.includes('FROM friend_add_rules') && !sql.includes(' r')) {
            return (state.anyRule ? { hit: 1 } : null) as T | null;
          }
          if (sql.includes('COUNT(*) AS c FROM scenarios')) return { c: state.scenarios } as T;
          if (sql.includes('SELECT 1 AS hit FROM scenarios')) {
            expect(bindings[0]).toBe('account-1');
            return (state.linkedScenario ? { hit: 1 } : null) as T | null;
          }
          return null;
        },
      });
      return make([]);
    },
  } as unknown as D1Database;
}

const { gettingStarted } = await import('./getting-started.js');

function makeApp(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当', role, readOnly: false, permissionKeys });
    return next();
  });
  app.route('/', gettingStarted);
  return app;
}

beforeEach(() => {
  state.tags = 1;
  state.fields = 0;
  state.anyRule = true;
  state.scenarios = 1;
  state.linkedScenario = true;
  state.rules = [{
    is_unknown_route_fallback: 1,
    definition_snapshot: JSON.stringify({ scenarioId: 'scenario-1', actions: [] }),
  }];
  db.hasFirstDeliveredMessage.mockResolvedValue(true);
  webhook.fetchWebhookEndpoint.mockResolvedValue({ status: 'matched' });
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    accounts: [{ id: 'account-1' }],
    ids: ['account-1'],
    canSeeUnassigned: false,
    isAccountScoped: false,
  });
});

describe('GET /api/getting-started', () => {
  it('5段を選択アカウントの実データから毎回計算する', async () => {
    const response = await makeApp().fetch(
      new Request('https://example.com/api/getting-started?account_id=account-1'),
      { DB: database() },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { doneCount: number; allDone: boolean; steps: Array<{ state: string }> } };
    expect(body.data.doneCount).toBe(5);
    expect(body.data.allDone).toBe(true);
    expect(body.data.steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('Webhookを確認できない段を完了にしない', async () => {
    webhook.fetchWebhookEndpoint.mockRejectedValue(new Error('temporary'));
    const response = await makeApp().fetch(
      new Request('https://example.com/api/getting-started?account_id=account-1'),
      { DB: database() },
    );
    const body = await response.json() as { data: { steps: Array<{ key: string; state: string }> } };
    expect(body.data.steps.find((step) => step.key === 'accounts')?.state).toBe('stalled');
  });

  it('設定が空なら未完了と理由を返す', async () => {
    state.tags = 0;
    state.fields = 0;
    state.anyRule = false;
    state.scenarios = 0;
    state.linkedScenario = false;
    state.rules = [];
    db.hasFirstDeliveredMessage.mockResolvedValue(false);
    const response = await makeApp().fetch(
      new Request('https://example.com/api/getting-started?account_id=account-1'),
      { DB: database() },
    );
    const body = await response.json() as {
      data: { doneCount: number; allDone: boolean; steps: Array<{ key: string; state: string }> };
    };
    expect(body.data.doneCount).toBe(1);
    expect(body.data.allDone).toBe(false);
    expect(body.data.steps.slice(1).map((step) => step.state)).toEqual([
      'todo', 'todo', 'todo', 'todo',
    ]);
  });

  it('権限のないスタッフには未完了段のボタンを返さない', async () => {
    state.tags = 0;
    state.fields = 0;
    const response = await makeApp('staff').fetch(
      new Request('https://example.com/api/getting-started?account_id=account-1'),
      { DB: database() },
    );
    const body = await response.json() as {
      data: { steps: Array<{ key: string; state: string; href: string | null }> };
    };
    expect(body.data.steps.find((step) => step.key === 'attributes')).toMatchObject({
      state: 'forbidden', href: null,
    });
  });

  it('担当外アカウントは存在を隠して404にする', async () => {
    const response = await makeApp().fetch(
      new Request('https://example.com/api/getting-started?account_id=account-2'),
      { DB: database() },
    );
    expect(response.status).toBe(404);
    expect(db.hasFirstDeliveredMessage).not.toHaveBeenCalledWith(expect.anything(), 'account-2');
  });
});
