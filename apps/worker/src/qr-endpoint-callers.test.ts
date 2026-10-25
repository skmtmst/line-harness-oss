import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from './test-utils/d1-sqlite.js';
import type { Env } from './worker-env.js';

/*
 * /api/qr を呼ぶ側が頼む絵の大きさを、実際に返す画面で確かめる。
 *
 * 受け取ったクエリをそのまま QR に載せる画面（流入リンク・LIFF の入口・LINE ログインの入口）は、
 * data を /api/qr の 2KiB 上限まで伸ばせる。絵の大きさと形式が固定であることが
 * 1 要求あたりの重さの歯止めになるので、PC で開いたときに返す HTML の QR だけを見る。
 * 呼び出し元の数え上げと、選べる側の上限は qr-endpoint.test.ts が持つ。
 */

const { app: rootApp } = await import('./index.js');
const { entryRoutes } = await import('./routes/entry-routes.js');

const PC = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const execCtx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

let testDb: SqliteD1;
let env: Env['Bindings'];

beforeEach(() => {
  testDb = createTestD1();
  env = {
    DB: testDb.db,
    LIFF_URL: 'https://liff.line.me/1234-abcdef',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_CHANNEL_SECRET: 'fixture-channel-secret',
    WORKER_URL: 'https://worker.example.test',
  } as Env['Bindings'];
});

afterEach(() => {
  testDb.raw.close();
});

/** 返した HTML の中の /api/qr の URL を全部拾う。 */
async function qrUrlsOf(response: Response): Promise<URL[]> {
  expect(response.status).toBe(200);
  const html = await response.text();
  return [...html.matchAll(/src="(\/api\/qr\?[^"]*)"/g)].map((match) => new URL(match[1].replaceAll('&amp;', '&'), 'https://worker.example.test'));
}

describe('受け取ったクエリをそのまま載せる画面は、240x240 の PNG しか頼まない', () => {
  it.each([
    ['流入リンク /r/:ref', '/r/spring-campaign-2026?utm_source=x'],
    ['LIFF の入口 /o', '/o?liffId=1234-abcdef&page=event&id=event-1'],
    ['LINE ログインの入口 /auth/line', '/auth/line?ref=spring-campaign-2026'],
  ])('%s', async (_label, path) => {
    const urls = await qrUrlsOf(await rootApp.request(path, { headers: PC }, env, execCtx));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.searchParams.get('size')).toBe('240x240');
      expect(url.searchParams.has('format')).toBe(false);
      expect(url.searchParams.get('data')).toBeTruthy();
    }
  });
});

describe('選べる側が載せる流入経路の合言葉は 64 文字まで', () => {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a' });
    return next();
  });
  app.route('/', entryRoutes);
  const create = (refCode: string) => app.request('/api/entry-routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refCode, name: '春のキャンペーン' }),
  }, env);

  it('65 文字は合言葉の決まりで断り、64 文字は合言葉の決まりでは断らない', async () => {
    const tooLong = await create('a'.repeat(65));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: expect.stringContaining('ref_code は64文字以内') });

    const longest = await create('a'.repeat(64));
    const body = await longest.text();
    expect(body).not.toContain('ref_code は64文字以内');
  });
});
