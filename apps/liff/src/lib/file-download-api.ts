import { responseLiffError } from './api-error.js';
import { getIdToken } from './liff-auth.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

/** 15 分のリンクの中身 (SIGNED-DOWNLOADS.md「添付の取り直し」)。 */
export interface IssuedFile {
  id: string;
  url: string;
  expiresAt: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'video' | 'file';
}

/**
 * 画面が分けて見せる失敗の種類。
 * login=LINEで確かめ直す / unavailable=別人・別店・削除・期限切れ・停止中 (同じ文) /
 * retry=時間をおく / unconfigured=お店へ問い合わせ / wait=Retry-After 秒待つ /
 * expired=取得用リンクの期限切れ / deleted=取得時に元が消えていた
 */
export type FileFailureKind = 'login' | 'unavailable' | 'retry' | 'unconfigured' | 'wait' | 'expired' | 'deleted';

export class FileDownloadError extends Error {
  code?: string; requestId?: string; fields: Record<string, string> = {}; status?: number;
  constructor(public kind: FileFailureKind, public retryAfterSeconds?: number) {
    super(kind);
  }
}

function failureOf(status: number, retryAfter: string | null, stage: 'issue' | 'fetch'): FileDownloadError {
  if (status === 401) return new FileDownloadError('login');
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new FileDownloadError('wait', Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30);
  }
  if (status === 503) return new FileDownloadError('unconfigured');
  if (stage === 'issue' && status === 404) return new FileDownloadError('unavailable');
  if (stage === 'fetch' && status === 404) return new FileDownloadError('deleted');
  if (stage === 'fetch' && status === 403) return new FileDownloadError('expired');
  return new FileDownloadError('retry');
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${getIdToken()}` };
}

/** 本人確認のうえ、最長 15 分の取得リンクを作る。友だち ID・店 ID は送らない。 */
export async function issueFile(id: string): Promise<IssuedFile> {
  const path = `/api/liff/files/${encodeURIComponent(id)}/download`;
  let response: Response;
  try {
    response = await fetch(new URL(`${BASE}${path}`, window.location.origin), {
      headers: headers(), cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
    });
  } catch {
    throw new FileDownloadError('retry');
  }
  if (!response.ok) throw await tracedFileFailure(response, failureOf(response.status, response.headers.get('Retry-After'), 'issue'));
  const body = (await response.json()) as { success?: boolean; data?: IssuedFile };
  if (body.success !== true || !body.data) throw new FileDownloadError('retry');
  return body.data;
}

/**
 * 取得リンクからファイル本体を Blob で受け取る。
 * 認証情報を付ける前に、リンクが同じ Worker の origin と所定の path であることを確かめる
 * (任意の外部 URL へ認証情報を送らない)。
 */
export async function fetchFileBlob(issued: IssuedFile): Promise<Blob> {
  const expected = new URL(`${BASE}/images/chat-attachments/${encodeURIComponent(issued.id)}`, window.location.origin);
  const signed = new URL(issued.url, window.location.origin);
  if (signed.origin !== expected.origin || signed.pathname !== expected.pathname || signed.searchParams.has('lineAccessToken')) {
    throw new FileDownloadError('retry');
  }
  let response: Response;
  try {
    response = await fetch(signed, { headers: headers(), cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch {
    throw new FileDownloadError('retry');
  }
  if (!response.ok) throw await tracedFileFailure(response, failureOf(response.status, response.headers.get('Retry-After'), 'fetch'));
  return response.blob();
}

/** ダウンロードの状態分類を保って共通の追跡情報を付ける。 */
export async function tracedFileFailure(response: Response, error: FileDownloadError): Promise<FileDownloadError> {
  const detail = await responseLiffError(response);
  error.code = detail.code; error.requestId = detail.requestId; error.fields = detail.fields; error.status = detail.status;
  return error;
}
