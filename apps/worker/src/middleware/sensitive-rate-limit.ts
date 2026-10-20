import type { Context } from 'hono';
import { bumpAuthThrottle, toJstString } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { readBoundedBytes } from '../lib/input-errors.js';
import { isOutputRequest } from './output-request.js';
import { isPublicApiBoundary } from './public-api-boundary.js';

const MINUTE = 60_000;
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function authAttempt(c: Context<Env>): boolean {
  if (c.req.path === '/api/auth/api-key' && ['POST','DELETE'].includes(c.req.method)) return true;
  return c.req.method === 'POST' && /^\/api\/auth\/(?:login|password\/(?:login|forgot|reset)|two-factor\/(?:verify|setup(?:\/confirm)?|recovery)|step-up)$/.test(c.req.path);
}
export function isUploadRequest(c: Context<Env>): boolean {
  if (!['POST', 'PUT'].includes(c.req.method)) return false;
  return /^(?:image\/|video\/|audio\/|application\/octet-stream|multipart\/form-data)/i.test(c.req.header('content-type') ?? '')
    || /^\/api\/(?:images$|media\/(?:upload-sessions|[^/]+\/versions)|forms\/[^/]+\/files$|liff\/nen\/(?:pets(?:\/[^/]+\/photo)?|photos)$|hq\/banners\/projects\/[^/]+\/uploads$|broadcasts\/[^/]+\/(?:media|upload)|rich-menu(?:s|groups)\/.*(?:image|upload))/.test(c.req.path);
}

/** All windows fit within one day. Retain two days so active budgets are never reset. */
export async function pruneSensitiveRateLimits(db: D1Database, now = new Date()): Promise<void> {
  await db.prepare("DELETE FROM auth_throttles WHERE key LIKE 'sensitive:%' AND updated_at < ?")
    .bind(toJstString(new Date(now.getTime() - 2 * 24 * 60 * MINUTE))).run();
}
async function reserve(c: Context<Env>, feature: string, principal: string, max: number, windowMs: number): Promise<Response | undefined> {
  try {
    const key = `sensitive:${feature}:${await digest(principal)}`;
    const count = await bumpAuthThrottle(c.env.DB, key, windowMs);
    if (count > max) return c.json({ success: false, code: 'rate_limited', error: 'しばらく待ってからもう一度お試しください' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(windowMs / 1000)) } });
  } catch {
    // A missing table or unavailable shared store must never fall back to isolate memory.
    return c.json({ success: false, code: 'rate_limit_unavailable', error: '現在処理を受け付けられません' },
      { status: 503, headers: { 'Retry-After': '60' } });
  }
}

/** Cloudflare supplies the connection IP. Unverified forwarding headers cannot create buckets. */
export async function preAuthSensitiveLimit(c: Context<Env>, authenticated = false): Promise<Response | undefined> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (authAttempt(c) && (authenticated || isPublicApiBoundary(c.req.method, c.req.path))) {
    const denied = await reserve(c, 'auth-ip', ip, 30, MINUTE);
    if (denied) return denied;
    const bytes = await readBoundedBytes(c.req.raw, 16 * 1024);
    if (bytes === null) return c.json({ success: false, code: 'auth_body_too_large', error: '送信内容が大きすぎます' }, 413);
    c.req.raw = new Request(c.req.raw, { body: bytes.byteLength ? bytes : null });
    if (/^\/api\/auth\/password\/(?:login|forgot|reset)$/.test(c.req.path)) {
      const body = await c.req.raw.clone().json().catch(() => ({})) as { email?: unknown };
      if (typeof body.email === 'string' && body.email.trim().length <= 254) {
        const reset = c.req.path.endsWith('/forgot');
        return reserve(c, reset ? 'reset-mail' : 'login-mail', body.email.trim().toLowerCase(), reset ? 3 : 10, reset ? 24 * 60 * MINUTE : 15 * MINUTE);
      }
    }
  } else if (isUploadRequest(c) && isPublicApiBoundary(c.req.method, c.req.path)) {
    return reserve(c, 'upload-ip', ip, 30, MINUTE);
  }
}

/** Authenticated export and upload budgets follow the verified tenant and staff, across IPs. */
export async function authenticatedSensitiveLimit(c: Context<Env>): Promise<Response | undefined> {
  const staff = c.get('staff');
  if (!staff) return;
  if (staff.readOnly && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && (authAttempt(c) || isUploadRequest(c))) {
    return c.json({ success: false, error: '閲覧のみのため実行できません' }, 403);
  }
  const principal = `${staff.tenantId ?? ''}:${staff.id}`;
  const output = isOutputRequest(c.req.path, c.req.query('format'), c.req.method);
  if (output) return reserve(c, 'export-staff', principal, 30, MINUTE);
  if (isUploadRequest(c)) {
    const denied = await reserve(c, 'upload-ip', c.req.header('cf-connecting-ip') ?? 'unknown', 30, MINUTE);
    return denied ?? reserve(c, 'upload-staff', principal, 30, MINUTE);
  }
  if (authAttempt(c)) {
    const denied = isPublicApiBoundary(c.req.method, c.req.path) ? undefined : await preAuthSensitiveLimit(c, true);
    return denied ?? reserve(c, 'auth-staff', principal, 30, MINUTE);
  }
}
