import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import { redirectWorker } from '../test-utils/workerd-redirect.js';

let worker: Miniflare;
beforeAll(async () => {
  worker = await redirectWorker(`
    import { Hono } from 'hono';
    import { apiContractMiddleware } from './middleware/api-contract.ts';
    import { withInvocation, currentRequestId, tracedFetch } from '@line-crm/shared/server';
    const app = new Hono();
    app.use('*', apiContractMiddleware);
    app.get('/api/trace', async c => {
      const first = currentRequestId();
      await new Promise(resolve => setTimeout(resolve, 0));
      const upstream = await tracedFetch('https://verify.example.com/trace');
      const body = await upstream.json();
      return c.json({ first, after: currentRequestId(), externalId: body.requestId });
    });
    app.post('/api/input', c => c.json({ error: '入力を確認してください', code: 'INVALID_INPUT', fields: { name: '名前を入力してください' } }, 422));
    app.get('/api/socket', () => {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      return new Response(null, { status: 101, webSocket: client });
    });
    export default { fetch(request, env, ctx) { return withInvocation('http', () => app.fetch(request, env, ctx)); } };
  `);
});
afterAll(async () => { await worker?.dispose(); });

it('実際のworkerdでも並列の依頼・非同期処理・外部通信を同じIDで追える', async () => {
  const responses = await Promise.all([worker.dispatchFetch('https://caller.test/api/trace', { headers: { 'X-Request-ID': 'customer@example.invalid' } }), worker.dispatchFetch('https://caller.test/api/trace')]);
  const ids = responses.map(response => response.headers.get('X-Request-ID'));
  expect(new Set(ids).size).toBe(2);
  for (let i = 0; i < responses.length; i++) {
    expect(await responses[i].json()).toEqual({ first: ids[i], after: ids[i], externalId: ids[i] });
    expect(ids[i]).toMatch(/^[0-9a-f-]{36}$/);
  }
});
it('workerdの422にも同じ共通形式を返す', async () => {
  const response = await worker.dispatchFetch('https://caller.test/api/input', { method: 'POST' });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ success: false, error: { code: 'INVALID_INPUT', message: '入力を確認してください', requestId: response.headers.get('X-Request-ID'), fieldErrors: [{ field: 'name', message: '名前を入力してください' }] } });
});
it('101の接続をResponseの複製で壊さない', async () => {
  const response = await worker.dispatchFetch('https://caller.test/api/socket', { headers: { Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  expect(response.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.webSocket).not.toBeNull();
  response.webSocket?.accept();
  response.webSocket?.close();
});
