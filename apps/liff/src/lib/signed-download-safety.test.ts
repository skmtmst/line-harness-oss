// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { fetchFileBlob, type IssuedFile } from './file-download-api.js';
import { fetchStatementBlob } from './statement-download-api.js';
import { setLiffContext } from './liff-auth.js';
vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'access-token' } }));
afterEach(() => vi.unstubAllGlobals());
const file = (url: string): IssuedFile => ({ id: 'file', url, expiresAt: '2099-01-01T00:00:00Z', filename: '人工画像', mimeType: 'image/png', kind: 'image', size: 1 });
it.each(['https://other.example/images/chat-attachments/file', '/images/chat-attachments/other', '/images/chat-attachments/file?lineAccessToken=secret'])('添付: 別の取得先・URLの認証情報は、送信前に拒否する (%s)', async (url) => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(fetchFileBlob(file(url))).rejects.toMatchObject({ kind: 'retry' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['file', 'statement'])('%s: 署名URLもBearerを付けたまま転送しない', async (kind) => {
  setLiffContext({ liffId: 'store', lineUserId: 'person', idToken: 'id-token' });
  const fetcher = vi.fn().mockResolvedValue(new Response('artificial')); vi.stubGlobal('fetch', fetcher);
  if (kind === 'file') await fetchFileBlob(file('/images/chat-attachments/file?expires=1&signature=s'));
  else await fetchStatementBlob('statement', { url: '/api/liff/affiliate/statements/statement/download?expires=1&signature=s', expiresAt: '2099-01-01T00:00:00Z' });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: `Bearer ${kind === 'file' ? 'id-token' : 'access-token'}` }, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
});
