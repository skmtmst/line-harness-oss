import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { signSupportRelay } from '../services/support-relay.js';
import { aiLoopSlackReports } from './ai-loop-slack-reports.js';

const payload = {
  version: 1,
  eventId: 'LOOP-143:started',
  taskId: 'LOOP-143',
  repository: 'skmtmst/nen-petfood-eccube',
  title: 'Slack報告専用経路を接続する',
  commander: 'codex',
  executor: 'meta',
  model: 'Muse Spark 1.3 Contributor',
  status: 'started',
  summary: '報告専用の接続テストを開始しました。',
  taskUrl: 'https://github.com/skmtmst/nen-petfood-eccube/issues/143',
  occurredAt: '2026-09-09T04:00:00.000Z',
  revision: 10,
};

function app() {
  const instance = new Hono<Env>();
  instance.route('/', aiLoopSlackReports);
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
    CODEX_SLACK_RELAY_SECRET_MASATO: 'relay-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_AI_LOOP_CHANNEL_ID: 'C-AI-LOOP',
  };
}

async function request(bodyValue: unknown, secret = 'relay-secret', bindings = env()) {
  const body = JSON.stringify(bodyValue);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return app().request('/api/integrations/ai-loop/reports', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nen-timestamp': timestamp,
      'x-nen-signature': await signSupportRelay(secret, timestamp, body),
    },
    body,
  }, bindings);
}

afterEach(() => vi.unstubAllGlobals());

describe('AI loop Slack report security boundary', () => {
  test('accepts a signed report and never exposes an inbound control route', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, messages: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ts: '100.200' })));
    vi.stubGlobal('fetch', fetcher);
    const response = await request(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, action: 'created' });
    expect((await app().request('/api/integrations/ai-loop/actions', { method: 'POST' }, env())).status).toBe(404);
  });

  test('rejects invalid signatures', async () => {
    const response = await request(payload, 'wrong-secret');
    expect(response.status).toBe(401);
  });

  test('rejects unknown fields and non-GitHub links', async () => {
    expect((await request({ ...payload, command: 'merge' })).status).toBe(400);
    expect((await request({ ...payload, taskUrl: 'https://example.com/task/143' })).status).toBe(400);
  });

  test('fails closed when the dedicated report channel is missing', async () => {
    const bindings = env();
    delete bindings.SLACK_AI_LOOP_CHANNEL_ID;
    expect((await request(payload, 'relay-secret', bindings)).status).toBe(503);
  });
});
