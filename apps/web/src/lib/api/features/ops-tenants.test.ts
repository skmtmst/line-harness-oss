import { beforeEach, expect, test, vi } from 'vitest';
import { fetchApi } from '../transport/request';
import { opsMethods } from './ops';

vi.mock('../transport/request', () => ({ fetchApi: vi.fn() }));
beforeEach(() => { vi.mocked(fetchApi).mockReset(); });
const summary = { active: 601, trialing: 0, suspended: 0, pastDue: 1 };

test('APIのページを順に読み、既存画面へ601社の配列と全体集計を返す', async () => {
  vi.mocked(fetchApi).mockImplementation(async path => {
    const query = new URL('https://example.invalid' + path).searchParams;
    const page = Number(query.get('cursor') ?? 0);
    expect(query.get('q')).toBe('Scale');
    expect(query.get('status')).toBe('active');
    expect(query.get('limit')).toBe('100');
    return { success: true, data: Array.from({ length: page === 6 ? 1 : 100 }, (_, i) => ({ id: String(page * 100 + i) })), summary, nextCursor: page === 6 ? null : String(page + 1) } as never;
  });
  const response = await opsMethods.ops.tenants({ q: 'Scale', status: 'active' });
  expect(response.data.map(row => row.id)).toEqual(Array.from({ length: 601 }, (_, i) => String(i)));
  expect(response.summary).toEqual(summary);
  expect(fetchApi).toHaveBeenCalledTimes(7);
});

test('続きの読取失敗を部分的な一覧の成功へ置き換えない', async () => {
  vi.mocked(fetchApi).mockResolvedValueOnce({ success: true, data: [{ id: 'first' }], summary, nextCursor: 'next' });
  vi.mocked(fetchApi).mockRejectedValueOnce(new Error('unavailable'));
  await expect(opsMethods.ops.tenants()).rejects.toThrow('unavailable');
});

test('同じ続きを返す異常応答は止め、無限に取得しない', async () => {
  vi.mocked(fetchApi).mockResolvedValue({ success: true, data: [{ id: 'first' }], summary, nextCursor: 'same' });
  await expect(opsMethods.ops.tenants()).rejects.toThrow('契約先一覧の続きを読み込めませんでした');
  expect(fetchApi).toHaveBeenCalledTimes(2);
});

test('ページ情報がない旧版の応答もそのまま利用できる', async () => {
  vi.mocked(fetchApi).mockResolvedValue({ success: true, data: [{ id: 'first' }], summary });
  expect((await opsMethods.ops.tenants()).data.map(row => row.id)).toEqual(['first']);
  expect(fetchApi).toHaveBeenCalledTimes(1);
});
