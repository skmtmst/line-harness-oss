// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'synthetic-access-token' } }));
import { setLiffContext } from './liff-auth.js';
import { fetchFileBlob, issueFile, type IssuedFile } from './file-download-api.js';
import { fetchStatementBlob, issueStatement } from './statement-download-api.js';

const id = '11111111-2222-3333-4444-555555555555';
const file: IssuedFile = { id, url: `/images/chat-attachments/${id}?expires=1&signature=synthetic`, expiresAt: '2099-01-01T00:00:00Z', filename: 'synthetic.pdf', mimeType: 'application/pdf', size: 1, kind: 'file' };
const operations = [
  { name: '明細の再発行', run: () => issueStatement(id), path: `/api/liff/affiliate/statements/${id}/download`, token: 'synthetic-access-token' },
  { name: '明細の本体', run: () => fetchStatementBlob(id, { url: `/api/liff/affiliate/statements/${id}/download?expires=1&signature=synthetic`, expiresAt: file.expiresAt }), path: `/api/liff/affiliate/statements/${id}/download`, token: 'synthetic-access-token' },
  { name: '添付の再発行', run: () => issueFile(id), path: `/api/liff/files/${id}/download`, token: 'synthetic-id-token' },
  { name: '添付の本体', run: () => fetchFileBlob(file), path: `/images/chat-attachments/${id}`, token: 'synthetic-id-token' },
];
const fetchMock = vi.fn();
beforeEach(() => {
  setLiffContext({ liffId: 'synthetic-liff', lineUserId: 'synthetic-user', idToken: 'synthetic-id-token' });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe.each(operations)('$nameの取得待ち時間', operation => {
  it.each([
    ['60', 60], [null, 30], ['invalid', 30], ['0', 30], ['-1', 30], ['1.5', 2], ['Infinity', 30],
  ] as const)('Retry-After %s は %s 秒として扱い、自動で再要求しない', async (header, seconds) => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429, headers: header === null ? {} : { 'Retry-After': header } }));
    await expect(operation.run()).rejects.toMatchObject({ kind: 'wait', retryAfterSeconds: seconds, status: 429 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input), window.location.origin);
    expect(url.pathname).toBe(operation.path);
    expect(url.searchParams.has('lineAccessToken')).toBe(false);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${operation.token}`);
    expect(init).toMatchObject({ cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  });
});
