import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertQaOutboundAllowed, qaEnabled, qaSafeBindings, qaOutboundStopped, withQaOutboundBoundary, QA_STAGING_DATABASE } from './staging-qa-safety.js';
import type { WorkerBindings } from '../worker-bindings.js';

const staging = {
  DEPLOY_ENV: 'staging', WORKER_NAME: 'nen-line-stg', D1_DATABASE_ID: QA_STAGING_DATABASE,
  WORKER_PUBLIC_URL: 'https://stg-api.musubo.jp', STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true',
} as WorkerBindings;
afterEach(() => vi.unstubAllGlobals());

test('実際の本番設定へQA旗を混ぜても有効にできない。環境名だけの偽装も拒否', () => {
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const variables = Object.fromEntries([...toml.matchAll(/^([A-Z_]+) = "([^"]*)"/gm)].map(match => [match[1], match[2]]));
  const production = { ...staging, ...variables, STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true' } as WorkerBindings;
  expect(qaEnabled(production)).toBe(false);
  expect(qaEnabled({ ...production, DEPLOY_ENV: 'staging' })).toBe(false);
  expect(qaEnabled(staging)).toBe(true);
  expect(toml).not.toMatch(/^STAGING_QA_/m);
});

test('LINE・Google・メール中継・Slack・決済・同一環境URLもネットワーク送信0', async () => {
  const network = vi.fn(async () => new Response('network'));
  vi.stubGlobal('fetch', network);
  for (const url of ['https://api.line.me/v2/bot/message/push', 'https://www.googleapis.com/calendar/v3/calendars',
    'https://mail.example.invalid/relay', 'https://slack.com/api/chat.postMessage', 'https://api.stripe.com/v1/charges', 'https://stg-api.musubo.jp/line-api/v2/bot/message/push']) {
    await expect(withQaOutboundBoundary(staging, () => fetch(url, { method: 'POST', body: '{}' }))).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  }
  expect(network).not.toHaveBeenCalled();
});

test('同時に走る本番呼出しとQA呼出しのポリシーが混ざらず、waitUntil相当の継続も遮断', async () => {
  const network = vi.fn(async () => new Response('production'));
  vi.stubGlobal('fetch', network);
  const production = { ...staging, DEPLOY_ENV: 'production' };
  let resume!: () => void;
  const signal = new Promise<void>(resolve => { resume = resolve; });
  const qa = withQaOutboundBoundary(staging, async () => {
    await signal;
    expect(() => assertQaOutboundAllowed()).toThrow('STAGING_QA_OUTBOUND_BLOCKED');
    await expect(fetch('https://example.invalid')).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  });
  expect(await withQaOutboundBoundary(production, () => fetch('https://example.invalid').then(response => response.text()))).toBe('production');
  resume(); await qa;
  expect(network).toHaveBeenCalledOnce();
  expect(() => assertQaOutboundAllowed()).not.toThrow();
});

test('サービス束縛からのメール・AI・遅延送信も止め、旗の片方を落としても送らない', async () => {
  const send = vi.fn(async () => undefined);
  const env = qaSafeBindings({ ...staging, EMAIL: { send }, AI: { run: send }, CODEX_MENTION_QUEUE: { send } } as unknown as WorkerBindings);
  await expect(env.EMAIL!.send({} as EmailMessage)).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  await expect(env.AI!.run('@cf/meta/llama-3-8b-instruct', { prompt: 'QA' })).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  await expect(env.CODEX_MENTION_QUEUE!.send({} as never)).rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  expect(send).not.toHaveBeenCalled();
  expect(qaOutboundStopped({ ...staging, STAGING_QA_OUTBOUND_DISABLED: 'false' })).toBe(true);
});


test.each([
  { DEPLOY_ENV: undefined }, { DEPLOY_ENV: 'production' }, { DEPLOY_ENV: 'development' },
  { WORKER_NAME: undefined }, { WORKER_NAME: 'nen-line' },
  { D1_DATABASE_ID: undefined }, { D1_DATABASE_ID: 'production-database' },
  { WORKER_PUBLIC_URL: undefined }, { WORKER_PUBLIC_URL: 'https://api.musubo.jp' },
  { STAGING_QA_ENABLED: undefined }, { STAGING_QA_ENABLED: 'false' },
  { STAGING_QA_OUTBOUND_DISABLED: undefined }, { STAGING_QA_OUTBOUND_DISABLED: 'false' },
])('環境の独立した条件を1つでも満たさなければ閉じる: %j', overrides => {
  expect(qaEnabled({ ...staging, ...overrides })).toBe(false);
});

test.each([
  { STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'false' },
  { STAGING_QA_ENABLED: 'false', STAGING_QA_OUTBOUND_DISABLED: 'true' },
])('片方だけの旗でも検証の通信を止める: %j', async flags => {
  const network = vi.fn(async () => new Response('network'));
  vi.stubGlobal('fetch', network);
  await expect(withQaOutboundBoundary({ ...staging, ...flags }, () => fetch('https://api.stripe.com/v1/charges')))
    .rejects.toThrow('STAGING_QA_OUTBOUND_BLOCKED');
  expect(network).not.toHaveBeenCalled();
});

test('本番だけの呼出しではfetchもサービス束縛も変更しない', async () => {
  const network = vi.fn(async () => new Response('production'));
  vi.stubGlobal('fetch', network);
  const production = { ...staging, DEPLOY_ENV: 'production' };
  expect(qaSafeBindings(production)).toBe(production);
  await withQaOutboundBoundary(production, () => fetch('https://example.invalid'));
  expect(globalThis.fetch).toBe(network);
  expect(network).toHaveBeenCalledOnce();
});


test('環境設定がない読み取りはQAを開かず、通常の処理と通信関数を保つ', () => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  expect(qaEnabled(undefined)).toBe(false);
  expect(qaOutboundStopped(undefined)).toBe(false);
  expect(qaSafeBindings(undefined)).toBeUndefined();
  expect(withQaOutboundBoundary(undefined, () => 'public metadata')).toBe('public metadata');
  expect(globalThis.fetch).toBe(network);
});
