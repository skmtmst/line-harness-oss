import type { Context } from 'hono';
import type { Env } from '../../../worker-env.js';
import type { AdminSameSite } from '../../admin-auth-config.js';
import { bearerToken, parseCookieHeader } from '../../auth-http.js';

export const ADMIN_AUTH_COOKIE = 'lh_admin_session';
export const ADMIN_SESSION_BEARER_PREFIX = 'lh_session:';
export const CSRF_COOKIE = 'lh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// 既定は 8 時間（要件 -30 §10）。利用者が明示して「記憶する」を選んだ
// ときだけ 7 日にする。cookie の Max-Age と admin_sessions.expires_at は
// 必ずこの同じ秒数から作り、ブラウザ側とサーバー側の期限を一致させる。
export const SESSION_DEFAULT_MAX_AGE = 8 * 60 * 60;
export const SESSION_REMEMBER_MAX_AGE = 7 * 24 * 60 * 60;
export const SESSION_MAX_AGE = SESSION_REMEMBER_MAX_AGE;

/** セッション行がある不透明トークンだけをハッシュキーへ解決する。API キー認証には更新対象の admin_sessions 行がないため null を返す。 */
export async function adminSessionTokenHashFromRequest(
  c: Context<Env>,
): Promise<string | null> {
  const bearer = bearerToken(c);
  if (bearer) {
    if (!bearer.startsWith(ADMIN_SESSION_BEARER_PREFIX)) return null;
    const token = bearer.slice(ADMIN_SESSION_BEARER_PREFIX.length);
    return token ? sha256Hex(token) : null;
  }
  const cookie = adminSessionTokenFromCookie(c);
  return cookie ? sha256Hex(cookie) : null;
}

export function adminSessionTokenFromCookie(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[ADMIN_AUTH_COOKIE] || null;
}

export function csrfTokenFromCookie(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[CSRF_COOKIE] || null;
}

function buildCookie(
  name: string,
  value: string,
  sameSite: AdminSameSite,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Secure', `SameSite=${sameSite}`, `Max-Age=${maxAge}`);
  return parts.join('; ');
}

/** セッショントークンを保持する Cookie は HttpOnly とする。 */
export function adminSessionCookie(token: string, sameSite: AdminSameSite, maxAge = SESSION_DEFAULT_MAX_AGE): string {
  return buildCookie(ADMIN_AUTH_COOKIE, token, sameSite, maxAge, true);
}

/** double-submit のため CSRF Cookie は HttpOnly にしない。別サイトでは管理画面が読めないため、ログイン応答にもトークンを返して X-CSRF-Token で送る。Worker はブラウザが返す SameSite=None の Cookie と照合する。 */
export function csrfCookie(token: string, sameSite: AdminSameSite, maxAge = SESSION_DEFAULT_MAX_AGE): string {
  return buildCookie(CSRF_COOKIE, token, sameSite, maxAge, false);
}

export function expiredCookie(name: string, sameSite: AdminSameSite): string {
  return buildCookie(name, '', sameSite, 0, name === ADMIN_AUTH_COOKIE);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
