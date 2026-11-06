import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticeLineConnectError, prepareNoticeLineConnection } from './notice-line-connect.js';

const input = {
  channelId: '2011579318',
  channelSecret: 'fixture-secret',
  expectedBasicId: '@540qlkhn',
  webhookUrl: 'https://stg-api.musubo.jp/webhook/2011579318',
};

function installFetch(options: { basicId?: string; endpoint?: string; active?: boolean; testSuccess?: boolean } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (request: string | URL | Request, init: RequestInit = {}) => {
    const url = String(request);
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    if (url.endsWith('/v2/oauth/accessToken')) return Response.json({ access_token: 'fixture-token', expires_in: 2592000 });
    if (url.endsWith('/v2/bot/info')) return Response.json({ displayName: 'musubo契約者様 問い合わせ/通知', basicId: options.basicId ?? input.expectedBasicId });
    if (url.endsWith('/v2/bot/channel/webhook/endpoint') && method === 'GET') return Response.json({ endpoint: options.endpoint ?? input.webhookUrl, active: options.active ?? true });
    if (url.endsWith('/v2/bot/channel/webhook/endpoint') && method === 'PUT') return Response.json({});
    if (url.endsWith('/v2/bot/channel/webhook/test')) return Response.json({ success: options.testSuccess ?? true });
    return new Response(null, { status: 404 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('契約者向けLINEのMessaging API接続', () => {
  it('正しい公式アカウントとWebhookを確認し、LINE LoginやLIFFを呼ばない', async () => {
    const calls = installFetch();
    const result = await prepareNoticeLineConnection(input);
    expect(result.profile.basicId).toBe('@540qlkhn');
    expect(calls.some(call => call.url.includes('/liff/') || call.url.includes('/login/'))).toBe(false);
    expect(calls.some(call => call.url.endsWith('/v2/bot/channel/webhook/test'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(input.channelSecret);
  });

  it('別の公式アカウントを誤指定した場合はWebhook変更前に停止する', async () => {
    const calls = installFetch({ basicId: '@different' });
    await expect(prepareNoticeLineConnection(input)).rejects.toMatchObject({ code: 'identity' } satisfies Partial<NoticeLineConnectError>);
    expect(calls.some(call => call.url.includes('/webhook/endpoint'))).toBe(false);
  });

  it('既存Webhookが別の宛先なら上書きせず停止する', async () => {
    const calls = installFetch({ endpoint: 'https://other.example.com/webhook' });
    await expect(prepareNoticeLineConnection(input)).rejects.toMatchObject({ code: 'webhook_in_use' });
    expect(calls.some(call => call.method === 'PUT')).toBe(false);
  });

  it('Webhookが無効ならアカウントを作成させない', async () => {
    installFetch({ active: false });
    await expect(prepareNoticeLineConnection(input)).rejects.toMatchObject({ code: 'webhook_inactive' });
  });
});
