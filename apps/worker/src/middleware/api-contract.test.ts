import type { ApiErrorResponse } from '@line-crm/shared';
import { Hono } from 'hono';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { currentRequestId, logger, tracedFetch } from '@line-crm/shared/server';
import { apiContractMiddleware, HTTP_ERROR_CODES } from './api-contract.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function app() { return new Hono().use('*', apiContractMiddleware); }

describe('全APIの失敗契約', () => {
  it.each(Object.keys(HTTP_ERROR_CODES).map(Number))('HTTP %iを変えず共通のエラー形とIDを返す', async status => {
    const api = app();
    api.get('/api/old', c => c.json({ error: '旧来の案内です。', data: { version: 3 } }, status as ContentfulStatusCode));
    const response = await api.request('/api/old', { headers: { 'X-Request-ID': 'customer@example.invalid', 'cf-ray': 'injected' } });
    const body = await response.json() as ApiErrorResponse;
    expect(response.status).toBe(status);
    expect(body).toEqual({ success: false, data: { version: 3 }, error: { code: HTTP_ERROR_CODES[status].code,
      message: '旧来の案内です。', fieldErrors: [], requestId: response.headers.get('X-Request-ID') } });
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('入力・conflict・未処理の失敗と401/403/404にも同じ入口を通す', async () => {
    const api = app();
    api.use('/api/private/*', async c => c.json({ error: 'Forbidden' }, 403));
    api.post('/api/input', c => c.json({ code: 'INVALID_INPUT', error: '形式を確認してください', fields: { title: '名前を入力してください' } }, 422));
    api.onError((_error, c) => c.json({ error: 'D1_ERROR SELECT secret FROM customers' }, 500));
    api.get('/api/broken', () => { throw new Error('Bearer secret'); });
    for (const [path, method, status] of [['private/resource', 'GET', 403], ['missing', 'GET', 404], ['broken', 'GET', 500], ['input', 'POST', 422]] as const) {
      const response = await api.request('/api/' + path, { method });
      expect(response.status).toBe(status);
      const body = await response.json() as ApiErrorResponse;
      expect(body.error).toMatchObject({ code: expect.any(String), message: expect.any(String), requestId: response.headers.get('X-Request-ID'), fieldErrors: expect.any(Array) });
      if (status === 422) expect(body.error.fieldErrors).toEqual([{ field: 'title', message: '名前を入力してください' }]);
      expect(JSON.stringify(body)).not.toMatch(/secret|D1_ERROR/);
    }
  });
  it('成功・CSV・空の応答・Retry-After・送達不明の機械情報を保つ', async () => {
    const api = app();
    api.get('/api/success', c => c.json({ special: ['original'], success: true }));
    api.get('/api/csv', c => c.body('name\nvalue\n', 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="same.csv"' }));
    api.delete('/api/empty', c => c.body(null, 204));
    api.post('/api/unknown', c => { c.header('Retry-After', '3600'); return c.json({ error: 'delivery_unknown', data: { canRetry: false }, incidentId: 'legacy' }, 409); });
    expect(await (await api.request('/api/success')).json()).toEqual({ special: ['original'], success: true });
    const csv = await api.request('/api/csv'); expect(await csv.text()).toBe('name\nvalue\n'); expect(csv.headers.get('Content-Disposition')).toContain('same.csv');
    const empty = await api.request('/api/empty', { method: 'DELETE' }); expect(empty.status).toBe(204); expect(await empty.text()).toBe('');
    const unknown = await api.request('/api/unknown', { method: 'POST' });
    expect(unknown.headers.get('Retry-After')).toBe('3600');
    expect(await unknown.json()).toMatchObject({ data: { canRetry: false }, incidentId: 'legacy', error: { code: 'delivery_unknown' } });
  });
  it('並列の依頼で応答・外部通信・ログのIDが一致する', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const api = app();
    api.get('/api/test', async c => { await Promise.resolve(); logger.info('test.request'); await tracedFetch('https://external.invalid'); return c.json({ trace: currentRequestId() }); });
    const responses = await Promise.all([api.request('/api/test'), api.request('/api/test')]);
    const ids = responses.map(r => r.headers.get('X-Request-ID'));
    expect(new Set(ids).size).toBe(2);
    expect(await Promise.all(responses.map(r => r.json().then(b => (b as { trace: string }).trace)))).toEqual(ids);
    expect(fetch.mock.calls.map(([, options]) => new Headers(options.headers).get('X-Request-ID')).sort()).toEqual([...ids].sort());
    expect(new Set(log.mock.calls.map(([text]) => JSON.parse(String(text)).requestId))).toEqual(new Set(ids));
  });
  it('MCPのJSON-RPCの負のcode/idをHTTPのエラーへ読み替えない', async () => {
    const api = app();
    const protocolError = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    api.post('/mcp', c => c.json(protocolError, 400));
    const response = await api.request('/mcp', { method: 'POST' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(protocolError);
    expect(response.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('OAuth等のHTML文書の失敗は、文書表示とHTTP状態を保つ', async () => {
    const api = app();
    const html = '<html><body>もう一度開き直してください。</body></html>';
    api.get('/api/example/callback', c => c.html(html, 400));
    const response = await api.request('/api/example/callback');
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(html);
    expect(response.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('大きい409の業務データも切り捨てず、再開に必要な情報を保つ', async () => {
    const api = app();
    const data = { currentVersion: 4, rows: Array.from({ length: 1500 }, (_, index) => ({ index, reason: '状態を確認してください。'.repeat(4) })) };
    api.post('/api/conflict', c => c.json({ code: 'VERSION_CONFLICT', error: '内容を確認してください', data }, 409));
    const response = await api.request('/api/conflict', { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ data, error: { code: 'VERSION_CONFLICT', requestId: response.headers.get('X-Request-ID') } });
  });
  it('書換えたエラーに古い本文の長さ・圧縮・ETagを付けず、待機やcookieは保つ', async () => {
    const api = app();
    api.get('/api/failure', c => c.json({ error: '入力を確認してください' }, 429, {
      'Content-Length': '1', 'Content-Encoding': 'gzip', ETag: '"old"', 'Cache-Control': 'public, max-age=120',
      'Retry-After': '60', 'Set-Cookie': 'session=; Max-Age=0; HttpOnly',
    }));
    const response = await api.request('/api/failure');
    expect(response.status).toBe(429);
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag']) expect(response.headers.get(name)).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMITED', requestId: response.headers.get('X-Request-ID') } });
  });
});
