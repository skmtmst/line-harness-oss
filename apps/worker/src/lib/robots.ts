import type { Context, Next } from 'hono';

/**
 * 検索に出さない（リリース前点検 2026-10-07・司令塔の許可で worker に足した）。
 *
 * api.musubo.jp は API と旧 LIFF・共有プレビューの配り先で、検索に出す
 * 画面は1つも無い。HTML を求める GET は全部 index.html が返るので、
 * /robots.txt を先に本物の robots として返し、全部の応答に
 * X-Robots-Tag を付ける。LINE などの共有プレビュー（OG）は robots を見ない
 * ので、共有の見え方は変わらない。
 */
export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';
export const X_ROBOTS_TAG = 'noindex, nofollow';

export function robotsTxtHandler(c: Context): Response {
  return c.text(ROBOTS_TXT, 200, { 'Cache-Control': 'public, max-age=3600' });
}

export async function noindexHeaderMiddleware(c: Context, next: Next): Promise<void> {
  await next();
  // 101（WebSocket の切り替え）は作り直せないので触らない。
  if (c.res.status === 101) return;
  c.header('X-Robots-Tag', X_ROBOTS_TAG);
}
