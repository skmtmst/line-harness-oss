import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { signSupportRelay } from '../services/support-relay.js';

const pushMessage = vi.hoisted(() => vi.fn(async () => ({ requestId: 'request-1' })));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

vi.mock('@line-crm/db', () => ({
  getFriendByLineUserId: vi.fn(async () => ({
    id: 'friend-1',
    line_user_id: 'U11111111111111111111111111111111',
    display_name: '利用者',
    metadata: '{}',
    line_account_id: null,
  })),
  getLineAccountById: vi.fn(async () => null),
}));

import { meetCallback } from './meet-callback.js';

function fakeDb() {
  const receipts = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) { statement.params = params; return statement; },
        async first() {
          if (sql.includes('meet_callback_receipts')) {
            const hash = receipts.get(String(statement.params[0]));
            return hash ? { payload_hash: hash } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO meet_callback_receipts')) {
            const [sessionId, hash] = statement.params.map(String);
            if (receipts.has(sessionId)) return { meta: { changes: 0 } };
            receipts.set(sessionId, hash);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return db as unknown as D1Database;
}

const payload = {
  session_id: 'session-1',
  scenario_id: 'scenario-1',
  line_user_id: 'U11111111111111111111111111111111',
  status: 'completed',
  transcripts: [{ question_text: '質問', transcript: '回答' }],
  completed_at: '2026-08-21T01:00:00.000Z',
};

function app() {
  const instance = new Hono<Env>();
  instance.route('/', meetCallback);
  return instance;
}

function env(db: D1Database): Env['Bindings'] {
  return {
    DB: db,
    IMAGES: {} as R2Bucket,
    RAW_MAIL: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    MEET_CALLBACK_SECRET: 'meet-secret',
    LINE_CHANNEL_SECRET: 'line-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY: 'api-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: 'https://worker.example.test',
  };
}

async function signedHeaders(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-nen-timestamp': timestamp,
    'x-nen-signature': await signSupportRelay('meet-secret', timestamp, body),
  };
}

describe('Meet callback security boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  test('anonymous forged callback is rejected before LINE or DB mutation', async () => {
    const body = JSON.stringify(payload);
    const response = await app().request('/api/meet-callback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }, env(fakeDb()));
    expect(response.status).toBe(401);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('signed callback is processed once and a replay is harmless', async () => {
    const body = JSON.stringify(payload);
    const headers = await signedHeaders(body);
    const db = fakeDb();
    const first = await app().request('/api/meet-callback', { method: 'POST', headers, body }, env(db));
    const replay = await app().request('/api/meet-callback', { method: 'POST', headers, body }, env(db));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, duplicate: true });
    expect(pushMessage).toHaveBeenCalledTimes(1);
  });
});
