import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('初回の値・時刻・版を固定し、provider失敗後に値が変わっても同じ本文で再試行する', async () => {
    const store = createTestD1();
    seedAccount(store.raw, 'account-a');
    seedVar(store.raw, { id: 'var-a', accountId: 'account-a', value: '本店A', version: 3 });
    seedScheduled(store.raw, 'broadcast-1', 'account-a');
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
    store.raw.prepare(`
      UPDATE broadcasts
         SET status = 'scheduled', scheduled_at = '2026-09-16T04:00:00.000Z'
       WHERE id = 'broadcast-1'
    `).run();
    vi.setSystemTime(new Date('2026-09-16T05:00:00.000Z'));
    await processScheduledBroadcasts(store.db, {} as never);

    expect(line.broadcasts).toHaveLength(2);
    expect(sentText()).toBe('店舗=本店A');
    expect((store.raw.prepare(`SELECT status FROM broadcasts WHERE id = 'broadcast-1'`).get() as { status: string }).status)
      .toBe('sent');
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
