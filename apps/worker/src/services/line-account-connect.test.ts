import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareLineConnection } from './line-account-connect.js';

const input = {
  channelId: '123456789',
  channelSecret: 'messaging-secret',
  loginChannelId: '2007123456',
  loginChannelSecret: 'login-secret',
  baseUrl: 'https://nen-line-stg.skmtmst.workers.dev',
};

type Failure = 'messaging-token' | 'bot' | 'webhook-inactive' | 'login-token' | 'liff-create' | null;

function installFetch(failure: Failure = null, existingLiffId?: string) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (request: string | URL | Request, init: RequestInit = {}) => {
    const url = String(request);
    const method = init.method ?? 'GET';
    const body = init.body ? String(init.body) : '';
    calls.push({ url, method, body });
    if (url.endsWith('/v2/oauth/accessToken')) {
      const clientId = new URLSearchParams(body).get('client_id');
      if ((clientId === input.channelId && failure === 'messaging-token') ||
          (clientId === input.loginChannelId && failure === 'login-token')) {
        return new Response(null, { status: 401 });
      }
      return Response.json({ access_token: `token-${clientId}`, expires_in: 2_592_000, token_type: 'Bearer' });
    }
    if (url.endsWith('/v2/bot/info')) {
      return failure === 'bot'
        ? new Response(null, { status: 502 })
        : Response.json({ displayName: 'テスト公式', pictureUrl: 'https://example.com/icon.png', basicId: '@test', chatMode: 'bot' });
    }
    if (url.endsWith('/v2/bot/channel/webhook/endpoint') && method === 'PUT') return Response.json({});
    if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
      return Response.json({ endpoint: `${input.baseUrl}/webhook`, active: failure !== 'webhook-inactive' });
    }
    if (url.endsWith('/v2/bot/channel/webhook/test')) return Response.json({ success: true });
    if (url.endsWith('/liff/v1/apps') && method === 'GET') {
      return Response.json({ apps: existingLiffId ? [{ liffId: existingLiffId, description: 'musubo' }] : [] });
    }
    if (url.endsWith('/liff/v1/apps') && method === 'POST') {
      return failure === 'liff-create'
        ? new Response(null, { status: 403 })
        : Response.json({ liffId: '2007123456-auto' });
    }
    if (url.includes('/liff/v1/apps/') && method === 'PUT') return Response.json({});
    return new Response(null, { status: 404 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('LINEアカウント自動接続', () => {
  it.each([
    ['messaging-token', 1],
    ['bot', 2],
    ['webhook-inactive', 3],
    ['login-token', 4],
    ['liff-create', 4],
  ] as const)('%sでは指定段で止まり、後続を未確認にする', async (failure, stoppedOrder) => {
    installFetch(failure);
    const result = await prepareLineConnection(input);
    expect(result.success).toBe(false);
    expect(result.steps.find((item) => item.state === 'failed')?.order).toBe(stoppedOrder);
    expect(result.steps.slice(stoppedOrder).every((item) => item.state === 'skipped')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(input.channelSecret);
    expect(JSON.stringify(result)).not.toContain(input.loginChannelSecret);
  });

  it('LIFFを作成し、liffId付きのURLへ更新する', async () => {
    const calls = installFetch();
    const result = await prepareLineConnection(input);
    expect(result.success).toBe(true);
    expect(result.liffId).toBe('2007123456-auto');
    const update = calls.find((call) => call.url.includes('/liff/v1/apps/2007123456-auto') && call.method === 'PUT');
    expect(update?.body).toContain('https://nen-line-stg.skmtmst.workers.dev?liffId=2007123456-auto');
  });

  it('descriptionがmusuboの既存LIFFを流用する', async () => {
    const calls = installFetch(null, '2007123456-existing');
    const result = await prepareLineConnection(input);
    expect(result.liffId).toBe('2007123456-existing');
    expect(calls.some((call) => call.url.endsWith('/liff/v1/apps') && call.method === 'POST')).toBe(false);
  });
});
