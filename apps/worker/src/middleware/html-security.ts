import type { MiddlewareHandler } from 'hono';
import type { Env } from '../worker-env.js';

/** Worker-generated LIFF/OGP HTML also needs protection; _headers covers static assets only. */
export const htmlSecurityMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  if (!c.res.headers.get('content-type')?.includes('text/html')) return;
  // ASSETS/fetch responses can have immutable headers. Rewrap without changing the body.
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers: new Headers(c.res.headers) });
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  c.header('Content-Security-Policy', "frame-ancestors 'self' https://*.line.me https://*.line-apps.com; object-src 'none'; base-uri 'self'; form-action 'self' https://access.line.me");
  c.header('Content-Security-Policy-Report-Only', "default-src 'self'; script-src 'self' https://static.line-scdn.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https:; frame-src 'self' https://access.line.me https://*.line.me https://*.line-apps.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://*.line.me https://*.line-apps.com");
};
