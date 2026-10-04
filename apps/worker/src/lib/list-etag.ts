import type { Context } from 'hono';

/**
 * よく開く一覧のための弱い ETag。
 *
 * ヘッダに入るのは SHA-256 の先頭だけ（復元できない一方向の値）。
 * 秘密値・個人情報の原文はヘッダに入れない。
 * 同じ中身なら 304 を返し、本文を送らない。
 */
export async function listETag(queryKey: string, bodyText: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${queryKey}\n${bodyText}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hex.slice(0, 32)}"`;
}

export function queryKeyOf(c: Context): string {
  const question = c.req.url.indexOf('?');
  return question < 0 ? '' : c.req.url.slice(question + 1);
}

/**
 * 一覧の応答を作る。中身が同じで送り主が持っていれば 304。
 * どれか違うときだけ本文と ETag を返す。
 */
export async function listResponse<T>(
  c: Context,
  body: T,
): Promise<Response> {
  const text = JSON.stringify(body);
  const etag = await listETag(queryKeyOf(c), text);
  if (c.req.header('if-none-match') === etag) {
    return new Response(null, { status: 304 });
  }
  return c.json(body, 200, {
    ETag: etag,
    'Cache-Control': 'private, max-age=0, must-revalidate',
  });
}
