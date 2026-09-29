import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const line = vi.hoisted(() => ({
  broadcasts: [] as unknown[][],
  failuresRemaining: 0,
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    async broadcast(messages: unknown[]) {
      line.broadcasts.push(messages);
      if (line.failuresRemaining > 0) {
        line.failuresRemaining--;
        throw new Error('provider temporarily unavailable');
      }
      return { requestId: 'request-1' };
    }
    async multicast() {}
    async pushMessage() {}
  },
}));

const { processScheduledBroadcasts } = await import('./broadcast.js');
const { prepareBroadcastCommonVarSnapshot } = await import('./common-var-snapshot.js');
const { broadcasts } = await import('../routes/broadcasts.js');

function broadcastApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', broadcasts);
  return app;
}

function seedAccount(raw: SqliteD1['raw'], id: string): void {
  raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active)
    VALUES (?, ?, ?, ?, 'secret', 1)
  `).run(id, `channel-${id}`, id, `token-${id}`);
}

function seedVar(
  raw: SqliteD1['raw'],
  input: {
    id: string;
    accountId: string;
    value: string;
    validUntil?: string | null;
    fallbackValue?: string | null;
    behavior?: 'stop' | 'fallback';
    version?: number;
  },
): void {
  raw.prepare(`
    INSERT INTO common_vars
      (id, line_account_id, name, var_key, type, value, valid_until,
       fallback_value, expiry_behavior, version)
    VALUES (?, ?, '店舗名', 'shop_name', 'text', ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.accountId,
    input.value,
    input.validUntil ?? null,
    input.fallbackValue ?? null,
    input.behavior ?? 'stop',
    input.version ?? 1,
  );
}

function seedScheduled(raw: SqliteD1['raw'], id: string, accountId: string): void {
  raw.prepare(`
    INSERT INTO broadcasts
      (id, title, message_type, message_content, target_type, status,
       scheduled_at, line_account_id, track_links)
    VALUES (?, '予約案内', 'text', '店舗={{var.shop_name}}', 'all', 'scheduled',
            '2026-09-16T00:00:00.000Z', ?, 0)
  `).run(id, accountId);
}

function sentText(): string | undefined {
  const message = line.broadcasts.at(-1)?.[0] as { text?: string } | undefined;
  return message?.text;
}

describe('N-188 予約配信の共通情報snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T02:00:00.000Z'));
    line.broadcasts = [];
    line.failuresRemaining = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota')) {
        return new Response(JSON.stringify({ type: 'limited', value: 1000 }), { status: 200 });
      }
      if (url.endsWith('/quota/consumption')) {
        return new Response(JSON.stringify({ totalUsage: 0 }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('provider失敗後に日時だけ再予約する同じ試行は、初回の値・時刻・版を使う', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, { id: 'var-a', accountId: 'account-a', value: '本店A', version: 3 });
    seedScheduled(store.raw, 'broadcast-1', 'account-a');
    store.raw.prepare(`
      UPDATE broadcasts
         SET message_bubbles_json = ?
       WHERE id = 'broadcast-1'
    `).run(JSON.stringify([{
      id: 'bubble-1',
      type: 'text',
      content: { text: '店舗={{var.shop_name}}' },
    }]));
    line.failuresRemaining = 1;

    await processScheduledBroadcasts(store.db, {} as never);
    const first = store.raw.prepare(`
      SELECT status, common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-1'
    `).get() as { status: string; common_var_snapshot: string; common_var_snapshot_at: string };
    expect(first.status).toBe('draft');
    expect(first.common_var_snapshot_at).toBe('2026-09-16T02:00:00.000Z');
    expect(JSON.parse(first.common_var_snapshot)).toMatchObject({
      executionAt: '2026-09-16T02:00:00.000Z',
      accounts: { 'account-a': { values: { shop_name: '本店A' }, entries: [{ version: 3 }] } },
    });

    store.raw.prepare(`UPDATE common_vars SET value = '本店B', version = 4 WHERE id = 'var-a'`).run();
    vi.setSystemTime(new Date('2026-09-16T05:00:00.000Z'));
    const response = await broadcastApp(store.db).request(
      '/api/broadcasts/broadcast-1',
      {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        // 実画面は再予約時に未変更の本文・対象・accountも再送する。
        body: JSON.stringify({
          messageType: 'text',
          messageContent: '店舗={{var.shop_name}}',
          // key順が違っても、画面上・送信上は同じbubble。
          messageBubbles: [{
            content: { text: '店舗={{var.shop_name}}' },
            type: 'text',
            id: 'bubble-1',
          }],
          targetType: 'all',
          targetTagId: null,
          lineAccountId: 'account-a',
          scheduledAt: '2026-09-16T04:00:00.000Z',
          expectedVersion: 1,
        }),
      },
      { DB: store.db } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    const retried = store.raw.prepare(`
      SELECT common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-1'
    `).get() as { common_var_snapshot: string; common_var_snapshot_at: string };
    expect(retried.common_var_snapshot_at).toBe('2026-09-16T02:00:00.000Z');
    expect(JSON.parse(retried.common_var_snapshot).accounts['account-a'].values.shop_name).toBe('本店A');
    await processScheduledBroadcasts(store.db, {} as never);

    expect(line.broadcasts).toHaveLength(2);
    expect(sentText()).toBe('店舗=本店A');
    expect((store.raw.prepare(`SELECT status FROM broadcasts WHERE id = 'broadcast-1'`).get() as { status: string }).status)
      .toBe('sent');
  });

  it('provider失敗後でも本文を編集した再予約は旧snapshotを捨てて新しい値を使う', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, { id: 'var-edit', accountId: 'account-a', value: '編集前', version: 1 });
    seedScheduled(store.raw, 'broadcast-edit', 'account-a');
    line.failuresRemaining = 1;
    await processScheduledBroadcasts(store.db, {} as never);
    expect(store.raw.prepare(`SELECT common_var_snapshot_at FROM broadcasts WHERE id = 'broadcast-edit'`).get())
      .toEqual({ common_var_snapshot_at: '2026-09-16T02:00:00.000Z' });

    store.raw.prepare(`UPDATE common_vars SET value = '編集後', version = 2 WHERE id = 'var-edit'`).run();
    vi.setSystemTime(new Date('2026-09-16T03:00:00.000Z'));
    const response = await broadcastApp(store.db).request(
      '/api/broadcasts/broadcast-edit',
      {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageContent: '更新={{var.shop_name}}',
          scheduledAt: '2026-09-16T02:30:00.000Z',
          expectedVersion: 1,
        }),
      },
      { DB: store.db } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(store.raw.prepare(`
      SELECT common_var_snapshot, common_var_snapshot_at FROM broadcasts WHERE id = 'broadcast-edit'
    `).get()).toEqual({ common_var_snapshot: null, common_var_snapshot_at: null });

    await processScheduledBroadcasts(store.db, {} as never);
    expect(sentText()).toBe('更新=編集後');
    expect(store.raw.prepare(`SELECT common_var_snapshot_at FROM broadcasts WHERE id = 'broadcast-edit'`).get())
      .toEqual({ common_var_snapshot_at: '2026-09-16T03:00:00.000Z' });
  });

  it('provider失敗後に対象を実際に変えた更新も旧snapshotを捨てる', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, { id: 'var-target', accountId: 'account-a', value: '対象変更前' });
    seedScheduled(store.raw, 'broadcast-target', 'account-a');
    line.failuresRemaining = 1;
    await processScheduledBroadcasts(store.db, {} as never);

    const response = await broadcastApp(store.db).request(
      '/api/broadcasts/broadcast-target',
      {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'tag', targetTagId: 'tag-new',
          scheduledAt: '2026-09-16T04:00:00.000Z', expectedVersion: 1,
        }),
      },
      { DB: store.db } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(store.raw.prepare(`
      SELECT target_type, target_tag_id, common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-target'
    `).get()).toEqual({
      target_type: 'tag', target_tag_id: 'tag-new',
      common_var_snapshot: null, common_var_snapshot_at: null,
    });
  });

  it('予約取消は次の予約へ旧試行を持ち越さないよう両snapshot列を消す', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedScheduled(store.raw, 'broadcast-cancel', 'account-a');
    store.raw.prepare(`
      UPDATE broadcasts
         SET common_var_snapshot_at = '2026-09-16T01:00:00.000Z',
             common_var_snapshot = '{"executionAt":"2026-09-16T01:00:00.000Z","accounts":{}}'
       WHERE id = 'broadcast-cancel'
    `).run();
    const response = await broadcastApp(store.db).request(
      '/api/broadcasts/broadcast-cancel/cancel',
      { method: 'POST' },
      { DB: store.db } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(store.raw.prepare(`
      SELECT status, scheduled_at, common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-cancel'
    `).get()).toEqual({
      status: 'draft', scheduled_at: null, common_var_snapshot: null, common_var_snapshot_at: null,
    });
  });

  it('期限切れ停止後に実routeで修正・再予約すると新しい試行時刻で解決して送る', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, {
      id: 'var-rebook', accountId: 'account-a', value: '旧案内',
      validUntil: '2026-09-16T02:00:00.000Z', behavior: 'stop', version: 1,
    });
    seedScheduled(store.raw, 'broadcast-rebook', 'account-a');

    await processScheduledBroadcasts(store.db, {} as never);
    expect(line.broadcasts).toHaveLength(0);
    expect(store.raw.prepare(`
      SELECT status, scheduled_at, common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-rebook'
    `).get()).toEqual({
      status: 'draft', scheduled_at: null, common_var_snapshot: null,
      common_var_snapshot_at: '2026-09-16T02:00:00.000Z',
    });

    store.raw.prepare(`
      UPDATE common_vars
         SET value = '新案内', valid_until = '2026-09-16T04:00:00.000Z', version = 2
       WHERE id = 'var-rebook'
    `).run();
    vi.setSystemTime(new Date('2026-09-16T03:00:00.000Z'));
    const response = await broadcastApp(store.db).request(
      '/api/broadcasts/broadcast-rebook',
      {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduledAt: '2026-09-16T02:30:00.000Z', expectedVersion: 1 }),
      },
      { DB: store.db } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    expect(store.raw.prepare(`
      SELECT status, common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-rebook'
    `).get()).toEqual({ status: 'scheduled', common_var_snapshot: null, common_var_snapshot_at: null });

    await processScheduledBroadcasts(store.db, {} as never);
    expect(line.broadcasts).toHaveLength(1);
    expect(sentText()).toBe('店舗=新案内');
    const final = store.raw.prepare(`
      SELECT status, common_var_snapshot_at FROM broadcasts WHERE id = 'broadcast-rebook'
    `).get() as { status: string; common_var_snapshot_at: string };
    expect(final).toEqual({ status: 'sent', common_var_snapshot_at: '2026-09-16T03:00:00.000Z' });
    expect(store.raw.prepare(`
      SELECT reason, execution_at FROM common_var_resolution_failures
       WHERE source_id = 'broadcast-rebook'
    `).all()).toEqual([{ reason: 'expired', execution_at: '2026-09-16T02:00:00.000Z' }]);
  });

  it('期限切れで代替なしはLINE送信0、下書きへ戻して理由を失敗台帳へ残す', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, {
      id: 'var-expired',
      accountId: 'account-a',
      value: '旧店舗名',
      validUntil: '2026-09-16T02:00:00.000Z',
      behavior: 'stop',
    });
    seedScheduled(store.raw, 'broadcast-expired', 'account-a');

    await processScheduledBroadcasts(store.db, {} as never);

    expect(line.broadcasts).toHaveLength(0);
    expect(store.raw.prepare(`
      SELECT status, scheduled_at, common_var_snapshot, common_var_snapshot_at
        FROM broadcasts WHERE id = 'broadcast-expired'
    `).get()).toEqual({
      status: 'draft',
      scheduled_at: null,
      common_var_snapshot: null,
      common_var_snapshot_at: '2026-09-16T02:00:00.000Z',
    });
    expect(store.raw.prepare(`
      SELECT line_account_id, source_kind, source_id, var_key, reason, execution_at
        FROM common_var_resolution_failures
    `).all()).toEqual([{
      line_account_id: 'account-a',
      source_kind: 'broadcast',
      source_id: 'broadcast-expired',
      var_key: 'shop_name',
      reason: 'expired',
      execution_at: '2026-09-16T02:00:00.000Z',
    }]);
  });

  it('同じキーが別accountにあっても配信元accountの値だけを固定する', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedAccount(store.raw, 'account-b');
    seedVar(store.raw, { id: 'var-a', accountId: 'account-a', value: '本店' });
    seedVar(store.raw, { id: 'var-b', accountId: 'account-b', value: '支店' });
    seedScheduled(store.raw, 'broadcast-account', 'account-a');

    await processScheduledBroadcasts(store.db, {} as never);

    expect(sentText()).toBe('店舗=本店');
    const snapshot = store.raw.prepare(`
      SELECT common_var_snapshot FROM broadcasts WHERE id = 'broadcast-account'
    `).get() as { common_var_snapshot: string };
    expect(Object.keys(JSON.parse(snapshot.common_var_snapshot).accounts)).toEqual(['account-a']);
  });

  it('resolver読取後の版競合はsnapshotを書かず、再試行も最初に固定した時刻で解決する', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, { id: 'var-race', accountId: 'account-a', value: '読取時', version: 1 });
    seedScheduled(store.raw, 'broadcast-race', 'account-a');
    const row = store.raw.prepare(`SELECT * FROM broadcasts WHERE id = 'broadcast-race'`).get() as {
      id: string;
      line_account_id: string;
      account_ids: string | null;
      common_var_snapshot: string | null;
      common_var_snapshot_at: string | null;
    };
    let mutateBeforeBatch = true;
    const racingDb = {
      prepare: store.db.prepare.bind(store.db),
      batch: async (statements: D1PreparedStatement[]) => {
        if (mutateBeforeBatch) {
          mutateBeforeBatch = false;
          store.raw.prepare(`
            UPDATE common_vars SET value = '競合後', version = 2 WHERE id = 'var-race'
          `).run();
        }
        return store.db.batch(statements);
      },
    } as unknown as D1Database;

    await expect(prepareBroadcastCommonVarSnapshot(
      racingDb,
      row,
      '店舗={{var.shop_name}}',
      '2026-09-16T02:00:00.000Z',
    )).rejects.toThrow();
    expect(store.raw.prepare(`
      SELECT common_var_snapshot, common_var_snapshot_at FROM broadcasts WHERE id = 'broadcast-race'
    `).get()).toEqual({
      common_var_snapshot: null,
      common_var_snapshot_at: '2026-09-16T02:00:00.000Z',
    });

    const retried = await prepareBroadcastCommonVarSnapshot(
      store.db,
      row,
      '店舗={{var.shop_name}}',
      '2026-09-16T09:00:00.000Z',
    );
    expect(retried).toMatchObject({
      executionAt: '2026-09-16T02:00:00.000Z',
      accounts: { 'account-a': { values: { shop_name: '競合後' }, entries: [{ version: 2 }] } },
    });
  });
});
