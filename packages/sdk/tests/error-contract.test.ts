import { afterEach, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/http.js';
import { LineHarnessError } from '../src/errors.js';

afterEach(() => vi.unstubAllGlobals());
it('共通の失敗形と旧応答を受け取り、コード・追跡・入力理由を落とさない', async () => {
  const id = 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0';
  const client = new HttpClient({ baseUrl: 'https://api.invalid', apiKey: 'secret', timeout: 1000 });
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: {
    code: 'INVALID_INPUT', message: '入力を確認してください', requestId: id,
    fieldErrors: [{ field: 'name', message: '名前を入力してください' }],
  } }), { status: 422 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'legacy' }), { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  const error = await client.post('/api/test', {}).catch(e => e);
  expect(error).toBeInstanceOf(LineHarnessError);
  expect(error).toMatchObject({ status: 422, code: 'INVALID_INPUT', requestId: id, fields: { name: '名前を入力してください' }, message: '入力を確認してください' });
  await expect(client.get('/api/test')).rejects.toMatchObject({ status: 400, message: 'legacy' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('壊れた項目の理由を除き、元のHTTP状態と追跡番号を保つ', async () => {
  const id = 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: {
    code: null, message: '入力を確認してください', requestId: 42,
    fieldErrors: [null, false, { field: 'name', message: '名前を入力してください' }, { field: 'other', message: 1 }],
  } }), { status: 422, headers: { 'X-Request-ID': id } })));
  const client = new HttpClient({ baseUrl: 'https://api.invalid', apiKey: 'secret', timeout: 1000 });
  await expect(client.post('/api/test', {})).rejects.toMatchObject({ name: 'LineHarnessError', status: 422, code: undefined, requestId: id, fields: { name: '名前を入力してください' } });
});
