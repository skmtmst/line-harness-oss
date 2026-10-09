import { afterEach, beforeAll, expect, it, vi } from 'vitest';
let api: typeof import('./api').api;
beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8788';
  ({ api } = await import('./api'));
});
afterEach(() => vi.unstubAllGlobals());
it('削除するフォルダとアカウントをURLでエスケープして指定する', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'folder/id', deleted: true } }), {
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  expect((await api.friendAddRules.deleteFolder('shop/id', 'folder/id')).data).toEqual({ id: 'folder/id', deleted: true });
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8788/api/friend-add-rules/folders/folder%2Fid?account_id=shop%2Fid', expect.objectContaining({ method: 'DELETE' }));
});
