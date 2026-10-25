import type { Context, Next } from 'hono';

/**
 * API と LIFF・共有プレビューは検索対象にしない。
 * HTML を求める GET が index.html へ進む前に本物の robots.txt を返し、全応答へ X-Robots-Tag を付ける。
 * LINE などの共有プレビューは robots を参照しないため、OG の見え方は保つ。
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
