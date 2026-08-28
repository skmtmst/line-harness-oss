import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { processQueuedBroadcasts, processScheduledBroadcasts } from './broadcast.js';

const ACCOUNT_TOKEN = 'account-secret-token';

function addAccount(raw: Database.Database, id: string): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES (?, ?, ?, ?, 'secret', 1)`,
  ).run(id, `channel-${id}`, id, ACCOUNT_TOKEN);
}

function addBroadcast(
  raw: Database.Database,
  id: string,
  kind: 'scheduled' | 'queued',
  accountId: string | null,
): void {
  raw.prepare(
    `INSERT INTO broadcasts
       (id, title, message_type, message_content, target_type, status, scheduled_at,
        batch_offset, segment_conditions, line_account_id, created_at)
     VALUES (?, '監査テスト', 'text', '本文', 'all', ?, ?, 0, ?, ?, ?)`,
  ).run(
    id,
    kind === 'scheduled' ? 'scheduled' : 'sending',
    kind === 'scheduled' ? '2020-01-01T00:00:00.000Z' : null,
    kind === 'queued' ? JSON.stringify([{ type: 'is_following', value: true }]) : null,
    accountId,
    '2026-01-01T00:00:00.000Z',
  );
}

function defaultClient(): import('@line-crm/line-sdk').LineClient {
  return {
    broadcast: vi.fn().mockResolvedValue({ requestId: 'request-id' }),
    multicast: vi.fn(),
    pushMessage: vi.fn(),
  } as unknown as import('@line-crm/line-sdk').LineClient;
}

async function run(kind: 'scheduled' | 'queued', accountId: string | null, accountExists: boolean) {
  const { db, raw } = createTestD1();
  if (accountId && accountExists) addAccount(raw, accountId);
  addBroadcast(raw, `broadcast-${kind}`, kind, accountId);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
    status: 200,
    headers: { 'x-line-request-id': 'request-id' },
  })));

  if (kind === 'scheduled') await processScheduledBroadcasts(db, defaultClient());
  else await processQueuedBroadcasts(db, defaultClient());

  return log.mock.calls.map(([value]) => String(value));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ['scheduled', 'broadcast.scheduled'],
  ['queued', 'broadcast.queued'],
] as const)('%s broadcast default-token fallback log', (kind, context) => {
  it('logs one event with a null account ID when no account is assigned', async () => {
    const logs = await run(kind, null, false);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toEqual({
      event: 'line_token_default_fallback',
      accountId: null,
      context,
    });
  });

  it('logs the missing account ID without exposing a token', async () => {
    const logs = await run(kind, 'missing-account', false);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toEqual({
      event: 'line_token_default_fallback',
      accountId: 'missing-account',
      context,
    });
    expect(logs.join('\n')).not.toContain(ACCOUNT_TOKEN);
  });

  it('does not log when the account-specific token is available', async () => {
    expect(await run(kind, 'existing-account', true)).toEqual([]);
  });
});
