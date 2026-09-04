import { describe, expect, it, vi, afterEach } from 'vitest';
import { compareWebhookUrl, expectedWebhookUrl, fetchWebhookEndpoint } from './webhook-endpoint.js';

/**
 * Webhook の照合。台帳 #134（はじめの設定の段1が要る）。
 *
 * 守りたいのは 1 点——**「確かめていない」を「登録されていない」と言わない**こと。
 * 通信が失敗しただけで「未登録」と出すと、運用者は直っているものを直しに行く。
 */

afterEach(() => vi.unstubAllGlobals());

describe('こちらの受け口', () => {
  it('末尾のスラッシュを重ねない', () => {
    expect(expectedWebhookUrl('https://w.example.com')).toBe('https://w.example.com/webhook');
    expect(expectedWebhookUrl('https://w.example.com/')).toBe('https://w.example.com/webhook');
  });
});

describe('URL の突き合わせ', () => {
  it('同じなら matched', () => {
    expect(compareWebhookUrl('https://w.example.com/webhook', 'https://w.example.com/webhook')).toBe('matched');
  });

  /* LINE の管理画面は末尾のスラッシュを付けたり付けなかったりする。 */
  it('末尾のスラッシュだけの違いを「違う」と言わない', () => {
    expect(compareWebhookUrl('https://w.example.com/webhook', 'https://w.example.com/webhook/')).toBe('matched');
  });

  it('違えば mismatched', () => {
    expect(compareWebhookUrl('https://w.example.com/webhook', 'https://old.example.com/webhook')).toBe('mismatched');
  });

  it('空なら unconfigured', () => {
    expect(compareWebhookUrl('https://w.example.com/webhook', null)).toBe('unconfigured');
    expect(compareWebhookUrl('https://w.example.com/webhook', '')).toBe('unconfigured');
  });

  /* **読めていないことを、登録されていないことにしない。** */
  it('読めていなければ unknown', () => {
    expect(compareWebhookUrl('https://w.example.com/webhook', undefined)).toBe('unknown');
  });
});

describe('LINE から読む', () => {
  it('登録されていれば突き合わせて返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ endpoint: 'https://w.example.com/webhook', active: true }),
      { status: 200 },
    )));
    const check = await fetchWebhookEndpoint('token', 'https://w.example.com/webhook');
    expect(check).toEqual({
      expectedUrl: 'https://w.example.com/webhook',
      actualUrl: 'https://w.example.com/webhook',
      active: true,
      status: 'matched',
    });
  });

  it('404 は「まだ登録していない」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const check = await fetchWebhookEndpoint('token', 'https://w.example.com/webhook');
    expect(check.status).toBe('unconfigured');
  });

  it.each([
    ['トークンが切れた', 401],
    ['LINE が落ちている', 500],
  ])('%s ときは unknown（未登録と言わない）', async (_label, status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
    const check = await fetchWebhookEndpoint('token', 'https://w.example.com/webhook');
    expect(check.status).toBe('unknown');
    expect(check.actualUrl).toBeNull();
  });

  it('通信そのものが失敗しても投げない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const check = await fetchWebhookEndpoint('token', 'https://w.example.com/webhook');
    expect(check.status).toBe('unknown');
  });
});
