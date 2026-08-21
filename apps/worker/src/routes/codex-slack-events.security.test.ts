import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { signSupportRelay } from '../services/support-relay.js';
import { codexSlackEvents } from './codex-slack-events.js';

const payload = {
  version: 1,
  eventId: 'session-1:turn-1:prompt_submitted',
  eventType: 'prompt_submitted',
  sessionId: 'session-1',
  operator: 'kenta',
  repository: 'owner/line-harness-nen',
  branch: 'codex/kenta-test',
  prNumber: 220,
  content: 'PR #220の修正を進める',
  occurredAt: '2026-08-21T01:00:00.000Z',
};

function app() {
  const instance = new Hono<Env>();
  instance.route('/', codexSlackEvents);
  return instance;
}

function env(): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    LINE_CHANNEL_SECRET: 'line-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY: 'api-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: 'https://worker.example.test',
    CODEX_SLACK_RELAY_SECRET: 'relay-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_DEFAULT_PR_CHANNEL_ID: 'C-PR',
  };
}

async function signedHeaders(body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-nen-timestamp': timestamp,
    'x-nen-signature': await signSupportRelay('relay-secret', timestamp, body),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Codex Slack relay security boundary', () => {
  test('署名のない送信をSlackへ流さない', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, env());
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('署名済みの送信だけをSlackの対象スレッドへ流す', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, messages: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '123.456' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '123.789' })));
    vi.stubGlobal('fetch', fetcher);
    const body = JSON.stringify(payload);
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', headers: await signedHeaders(body), body,
    }, env());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      category: 'fix',
      channelId: 'C-PR',
      threadTs: '123.456',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test('秘密設定がない状態では動かさない', async () => {
    const current = env();
    delete current.CODEX_SLACK_RELAY_SECRET;
    const response = await app().request('/api/integrations/codex-slack/events', {
      method: 'POST', body: JSON.stringify(payload),
    }, current);
    expect(response.status).toBe(503);
  });
});
