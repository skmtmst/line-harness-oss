import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

let worker: Miniflare;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const esbuild = createRequire(require.resolve('vite'))('esbuild') as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
  };
  const bundle = await esbuild.build({
    stdin: { contents: `
      import { Hono } from 'hono';
      import { timingStart, timingHandler } from './lib/server-timing.ts';
      const app = new Hono();
      app.use('*', timingStart());
      app.use('*', timingHandler());
      app.get('/api/db', async c => {
        const db = c.env.DB;
        const one = db.prepare('SELECT ? AS value').bind(7);
        const first = await one.first('value');
        const batch = await db.batch([one, db.prepare('SELECT 8 AS value')]);
        const session = db.withSession('first-primary');
        const other = await session.prepare('SELECT 9 AS value').all();
        return c.json({ first, batch: batch.map(x => x.results[0].value), other: other.results[0].value });
      });
      app.get('/api/socket', () => {
        const pair = new WebSocketPair();
        pair[1].accept();
        return new Response(null, { status: 101, webSocket: pair[0] });
      });
      app.get('/api/redirect', () => Response.redirect('https://example.invalid', 302));
      export default app;
    `, resolveDir: resolve(process.cwd(), 'src'), sourcefile: 'timing-fixture.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  worker = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2024-12-01', d1Databases: ['DB'], d1Persist: false });
});
afterAll(async () => { await worker?.dispose(); });

it('workerdの本物のD1 Bindingでもthis・batch・session・回数を保つ', async () => {
  const responses = await Promise.all([worker.dispatchFetch('https://worker.test/api/db'), worker.dispatchFetch('https://worker.test/api/db')]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ first: 7, batch: [7, 8], other: 9 });
    expect(response.headers.get('Server-Timing')).toContain('d1_count;desc="3"');
    expect(response.headers.get('Server-Timing')).toContain('d1_sql_count;desc="3"');
  }
});

it('本物のimmutableなredirectとWebSocket接続にもヘッダを付けて状態を保つ', async () => {
  const redirect = await worker.dispatchFetch('https://worker.test/api/redirect', { redirect: 'manual' });
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('Location')).toBe('https://example.invalid/');
  expect(redirect.headers.get('Server-Timing')).toContain('total;dur=');
  const socket = await worker.dispatchFetch('https://worker.test/api/socket', { headers: { Upgrade: 'websocket' } });
  expect(socket.status).toBe(101);
  expect(socket.headers.get('Server-Timing')).toContain('total;dur=');
  expect(socket.webSocket).not.toBeNull();
  socket.webSocket?.accept();
  socket.webSocket?.close();
});
