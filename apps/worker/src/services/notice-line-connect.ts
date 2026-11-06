import { tracedFetch as fetch } from '@line-crm/shared/server';
import { issueLineAccessToken } from './token-refresh.js';

export class NoticeLineConnectError extends Error {
  constructor(public readonly code: 'credentials' | 'profile' | 'identity' | 'webhook_in_use' | 'webhook_inactive' | 'webhook_test') {
    super(code);
  }
}

/** 契約者向けの通知専用LINEはLINEログインとLIFFを使わない。受信に必要なMessaging APIだけを確認する。 */
export async function prepareNoticeLineConnection(input: {
  channelId: string;
  channelSecret: string;
  expectedBasicId: string;
  webhookUrl: string;
}): Promise<{ accessToken: string; profile: { displayName: string; pictureUrl: string | null; basicId: string } }> {
  let accessToken: string;
  try {
    accessToken = (await issueLineAccessToken(input.channelId, input.channelSecret)).access_token;
  } catch {
    throw new NoticeLineConnectError('credentials');
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  let profile: { displayName?: unknown; pictureUrl?: unknown; basicId?: unknown };
  try {
    const result = await fetch('https://api.line.me/v2/bot/info', { headers, signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error('profile');
    profile = await result.json();
  } catch {
    throw new NoticeLineConnectError('profile');
  }
  if (typeof profile.displayName !== 'string' || typeof profile.basicId !== 'string') {
    throw new NoticeLineConnectError('profile');
  }
  if (profile.basicId.toLowerCase() !== input.expectedBasicId.toLowerCase()) {
    throw new NoticeLineConnectError('identity');
  }

  const webhookHeaders = { ...headers, 'Content-Type': 'application/json' };
  let previous: { endpoint?: unknown; active?: unknown };
  try {
    const result = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', { headers, signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error('webhook');
    previous = await result.json();
  } catch {
    throw new NoticeLineConnectError('webhook_test');
  }
  const currentUrl = typeof previous.endpoint === 'string' ? previous.endpoint.replace(/\/+$/, '') : '';
  if (currentUrl && currentUrl !== input.webhookUrl.replace(/\/+$/, '')) {
    throw new NoticeLineConnectError('webhook_in_use');
  }
  if (currentUrl !== input.webhookUrl.replace(/\/+$/, '')) {
    try {
      const result = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
        method: 'PUT', headers: webhookHeaders,
        body: JSON.stringify({ endpoint: input.webhookUrl }), signal: AbortSignal.timeout(10_000),
      });
      if (!result.ok) throw new Error('webhook');
    } catch {
      throw new NoticeLineConnectError('webhook_test');
    }
  }
  let endpoint: { endpoint?: unknown; active?: unknown };
  try {
    const result = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', { headers, signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error('webhook');
    endpoint = await result.json();
  } catch {
    throw new NoticeLineConnectError('webhook_test');
  }
  if (endpoint.endpoint !== input.webhookUrl) throw new NoticeLineConnectError('webhook_test');
  if (endpoint.active !== true) throw new NoticeLineConnectError('webhook_inactive');
  try {
    const result = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
      method: 'POST', headers: webhookHeaders, body: '{}', signal: AbortSignal.timeout(10_000),
    });
    const body = result.ok ? await result.json<{ success?: boolean }>() : null;
    if (body?.success !== true) throw new Error('webhook');
  } catch {
    throw new NoticeLineConnectError('webhook_test');
  }
  return { accessToken, profile: {
    displayName: profile.displayName,
    pictureUrl: typeof profile.pictureUrl === 'string' ? profile.pictureUrl : null,
    basicId: profile.basicId,
  } };
}
