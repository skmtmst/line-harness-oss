// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'self-token' } }));
import { affiliateSelfApi } from './affiliate-self-api.js';
afterEach(() => vi.unstubAllGlobals());
it.each(['rewards', 'bank', 'statements'] as const)('F02: %s の認証はURLに入れず、保存・参照元・転送を止める', async (method) => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"data":[],"rewards":[],"availableMiles":0}'));
  vi.stubGlobal('fetch', fetcher);
  await affiliateSelfApi[method]();
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).not.toContain('self-token');
  expect(new URL(String(url)).searchParams.has('lineAccessToken')).toBe(false);
  expect(init).toMatchObject({ headers: { Authorization: 'Bearer self-token' }, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
});
it('本人トークンと再送キーを既存の交換と振込先の口へ渡す', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response('{"data":null,"status":"succeeded"}'));
  vi.stubGlobal('fetch', fetcher);
  await affiliateSelfApi.redeem('r/1', 'operation-1');
  await affiliateSelfApi.saveBank({ bankCode: '0001', bankName: '銀行', branchCode: '123', branchName: '本店', accountType: 'ordinary', accountNumber: '1234567', accountHolderName: 'タナカ' }, 7, 'operation-2');
  expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/api/liff/mileage/rewards/r%2F1/redeem');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Idempotency-Key': 'operation-1' }, body: JSON.stringify({ lineAccessToken: 'self-token' }) });
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'Idempotency-Key': 'operation-2' } });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ expectedVersion: 7, lineAccessToken: 'self-token', accountNumber: '1234567' });
});
it('GETの本人トークンと欄エラーを失わず渡す', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"data":[]}'))
    .mockResolvedValueOnce(new Response('{"error":"口座番号を確認してください","fields":{"accountNumber":"数字で入力してください"}}', { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await affiliateSelfApi.statements()).toEqual([]);
  expect(new URL(String(fetcher.mock.calls[0][0])).search).toBe('');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer self-token');
  await expect(affiliateSelfApi.redeem('r1', 'op')).rejects.toMatchObject({ status: 400, fields: { accountNumber: '数字で入力してください' } });
});
it('明細URLに認証情報を載せず、別originへの署名URLへ認証情報を送らない', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { url: 'https://foreign.example/fixture' } })));
  vi.stubGlobal('fetch', fetcher);
  await expect(affiliateSelfApi.download('statement-1')).rejects.toThrow('取得用URLが無効');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(new URL(String(url)).searchParams.has('lineAccessToken')).toBe(false);
  expect(init.headers.Authorization).toBe('Bearer self-token');
});
