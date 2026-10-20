import liff from '@line/liff';
import { FileDownloadError, tracedFileFailure } from './file-download-api.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export interface IssuedStatement { url: string; expiresAt: string }

/** 明細の API は access token (添付は ID token)。混ぜない。 */
function headers(): Record<string, string> {
  const token = liff.getAccessToken();
  if (!token) throw new FileDownloadError('login');
  return { Authorization: `Bearer ${token}` };
}

function failureOf(status: number, retryAfter: string | null, stage: 'issue' | 'fetch'): FileDownloadError {
  if (status === 400 || status === 401) return new FileDownloadError('login');
  if (status === 404) return new FileDownloadError('unavailable');
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new FileDownloadError('wait', Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30);
  }
  if (status === 503) return new FileDownloadError('unconfigured');
  if (stage === 'fetch' && status === 403) return new FileDownloadError('expired');
  return new FileDownloadError('retry');
}

function downloadPath(id: string): string {
  return `${BASE}/api/liff/affiliate/statements/${encodeURIComponent(id)}/download`;
}

/** 本人確認のうえ、最長 15 分の取得リンクを作る (本文は読まない)。 */
export async function issueStatement(id: string): Promise<IssuedStatement> {
  const url = new URL(downloadPath(id), window.location.origin);
  url.searchParams.set('issue', '1');
  let response: Response;
  try {
    response = await fetch(url, { headers: headers(), cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch (err) {
    if (err instanceof FileDownloadError) throw err;
    throw new FileDownloadError('retry');
  }
  if (!response.ok) throw await tracedFileFailure(response, failureOf(response.status, response.headers.get('Retry-After'), 'issue'));
  const body = (await response.json()) as { success?: boolean; data?: IssuedStatement };
  if (body.success === false || !body.data?.url) throw new FileDownloadError('retry');
  return body.data;
}

/** 取得リンクが同じ origin・所定の path で、認証情報の query が無いことを確かめてから PDF を受け取る。 */
export async function fetchStatementBlob(id: string, issued: IssuedStatement): Promise<Blob> {
  const expected = new URL(downloadPath(id), window.location.origin);
  const signed = new URL(issued.url, window.location.origin);
  if (signed.origin !== expected.origin || signed.pathname !== expected.pathname || signed.searchParams.has('lineAccessToken')) {
    throw new FileDownloadError('retry');
  }
  let response: Response;
  try {
    response = await fetch(signed, { headers: headers(), cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch (err) {
    if (err instanceof FileDownloadError) throw err;
    throw new FileDownloadError('retry');
  }
  if (!response.ok) throw await tracedFileFailure(response, failureOf(response.status, response.headers.get('Retry-After'), 'fetch'));
  return response.blob();
}
