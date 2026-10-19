/**
 * General burst budgets use isolate memory. Sensitive actions additionally
 * reserve shared D1 budgets in sensitive-rate-limit.ts, before doing work.
 *
 * Cloudflare Workers have per-isolate memory that persists across
 * requests to the same instance. Counters are lost on cold start,
 * which is acceptable — this guards against burst abuse, not
 * long-term quota enforcement.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../worker-env.js';
import { authenticatedSensitiveLimit, preAuthSensitiveLimit } from './sensitive-rate-limit.js';

// ---------------------------------------------------------------------------
// Core rate-limit logic
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const PRUNE_INTERVAL = 60_000;
let lastPrune = Date.now();

function prune(windowMs: number): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL) return;
  lastPrune = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

function check(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  prune(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= max) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }

  entry.timestamps.push(now);
  return { ok: true, remaining: max - entry.timestamps.length, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Paths that are unauthenticated (lower limit, keyed by IP)
// ---------------------------------------------------------------------------

const UNAUTHENTICATED_PATTERNS: Array<string | RegExp> = [
  '/webhook',
  /^\/webhook\/\d+$/,
  /^\/api\/forms\/[^/]+\/submit$/,
  // サイトスクリプトの受け口。認証が無く、外のサイトから直接叩かれる。
  '/api/site/collect',
  // R429: 公開受信口。署名で守る公開口で、管理画面の認証は通さない。
  // 未検証の Bearer/Cookie で認証済み枠（1000/分）へ切り替わると
  // 公開受信の負荷抑制が緩むため、Authorization の有無によらず IP 枠で抑える。
  /^\/api\/webhooks\/incoming\/[^/]+\/receive$/,
  '/api/qr',
  // Public referral URLs do database work too. Share one IP budget across
  // changing refs/help/query values and ignore unverified credentials.
  /^\/r\//,
  /^\/liff\/(?:files|statements)\//,
  /^\/api\/liff\/files\//,
  // 会員登録・メールログイン・パスワード再設定。認証前に叩かれる入口なので低い上限にする。
  /^\/api\/auth\/(register|password)\//,
];

function isUnauthenticatedPath(path: string): boolean {
  return UNAUTHENTICATED_PATTERNS.some((p) =>
    typeof p === 'string' ? path === p : p.test(path),
  );
}

function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0'
  );
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

const AUTHENTICATED_MAX = 1000;
const AUTHENTICATED_WINDOW = 60_000; // 1 min

const UNAUTHENTICATED_MAX = 100;
const UNAUTHENTICATED_WINDOW = 60_000; // 1 min

export async function rateLimitMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;

  // Public documentation does not perform referral lookups.
  if (path === '/docs' || path === '/openapi.json') {
    return next();
  }
  const denied = await preAuthSensitiveLimit(c);
  if (denied) return denied;

  let key: string;
  let max: number;
  let windowMs: number;

  if (isUnauthenticatedPath(path)) {
    // Key by IP for unauthenticated endpoints
    key = `ip:${getClientIp(c)}`;
    max = path === '/api/qr' ? 30 : UNAUTHENTICATED_MAX;
    windowMs = UNAUTHENTICATED_WINDOW;
  } else {
    // 認証前は資格情報の文字列に触れずIPだけで分ける。
    key = `pre-auth-ip:${getClientIp(c)}`;
    max = 3000; // 同じ店内ネットワークの複数利用者を合わせた従来の天井。
    windowMs = AUTHENTICATED_WINDOW;
  }

  const result = check(key, max, windowMs);

  if (!result.ok) {
    return c.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }

  // Proceed and attach rate-limit headers to the response
  await next();

  c.header('X-RateLimit-Remaining', String(result.remaining));
}

/** 認証を通った後は確認済みの統括・利用者で分ける。 */
export async function authenticatedRateLimitMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const staff = c.get('staff');
  if (!staff || isUnauthenticatedPath(c.req.path)) return next();
  const denied = await authenticatedSensitiveLimit(c);
  if (denied) return denied;
  const result = check(`staff:${staff.tenantId ?? ''}:${staff.id}`, AUTHENTICATED_MAX, AUTHENTICATED_WINDOW);
  if (!result.ok) return c.json({ success: false, error: 'Too many requests. Please try again later.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } });
  await next();
  c.header('X-RateLimit-Remaining', String(result.remaining));
}
