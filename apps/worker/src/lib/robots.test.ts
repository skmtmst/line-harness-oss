import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { noindexHeaderMiddleware, robotsTxtHandler, ROBOTS_TXT } from './robots.js';

function makeApp() {
  const app = new Hono();
  app.use('*', noindexHeaderMiddleware);
  app.get('/robots.txt', robotsTxtHandler);
  // 画面を返す口の代わり（静的ファイルの fetch で受け取った応答をそのまま返す形）
  app.get('*', async () => fetchLike());
  return app;
}

async function fetchLike(): Promise<Response> {
  const res = new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return res;
}

describe('検索に出さない（worker）', () => {
  it('/robots.txt は画面の HTML ではなく、全部拒否の robots を返す', async () => {
    const res = await makeApp().request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toBe(ROBOTS_TXT);
    expect(ROBOTS_TXT).toContain('Disallow: /');
  });

  it('画面・API の応答に X-Robots-Tag: noindex を付ける', async () => {
    const res = await makeApp().request('/booking');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('本体の index.ts が robots の口と見出しを全部の応答の前に付けている', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    const robots = src.indexOf("app.get('/robots.txt', robotsTxtHandler)");
    const header = src.indexOf("app.use('*', noindexHeaderMiddleware)");
    const auth = src.indexOf("app.use('*', authMiddleware)");
    expect(robots).toBeGreaterThan(0);
    expect(header).toBeGreaterThan(0);
    // ログインの見張りより前（ログインしていないボットにも返す）
    expect(robots).toBeLessThan(auth);
    expect(header).toBeLessThan(auth);
  });
});
