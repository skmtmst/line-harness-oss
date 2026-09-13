import type { Context } from 'hono';
import type { Env } from '../index.js';
import { adminSessionCookie, csrfCookie, SESSION_MAX_AGE, sha256Hex } from '../middleware/auth.js';
import { createAdminSession, createTwoFactorChallenge, deleteExpiredTwoFactorChallenges, type StaffMember } from '@line-crm/db';

/**
 * 権限者のセッション発行と、それに付随する小さな道具。
 *
 * LINE ログイン（routes/admin-auth.ts）とメール＋パスワードのログイン
 * （routes/auth-email.ts）で同じものを使う。発行のしかたを 2 か所に書かない。
 */

export const TWO_FACTOR_CHALLENGE_MAX_AGE = 5 * 60 * 1000;

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * 接続元のIP。
 *
 * Cloudflare が付けるヘッダを優先する。前段のプロキシが入る構成でも
 * 何かしら残るよう、順に見て最初に見つかったものを使う。
 */
export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    null
  );
}

export async function issueSession(c: Context<Env>, staffId: string, sameSite: 'Strict' | 'Lax' | 'None') {
  const sessionToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await createAdminSession(c.env.DB, await sha256Hex(sessionToken), staffId, expiresAt);
  const csrfToken = randomToken();
  c.header('Set-Cookie', adminSessionCookie(sessionToken, sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, sameSite), { append: true });
  return { csrfToken, sessionToken };
}

export function twoFactorRequired(staff: Pick<StaffMember, 'totp_enabled_at' | 'totp_secret_enc'>): boolean {
  return Boolean(staff.totp_enabled_at && staff.totp_secret_enc);
}

/** 二段階認証の合言葉を作って返す。画面はこれを `/login/two-factor#lh_2fa=` で受け取る。 */
export async function startTwoFactorChallenge(c: Context<Env>, staffId: string): Promise<string> {
  const challengeToken = randomToken();
  await deleteExpiredTwoFactorChallenges(c.env.DB, new Date().toISOString());
  await createTwoFactorChallenge(
    c.env.DB,
    await sha256Hex(challengeToken),
    staffId,
    new Date(Date.now() + TWO_FACTOR_CHALLENGE_MAX_AGE).toISOString(),
  );
  return challengeToken;
}

export function twoFactorLoginUrl(c: Context<Env>, challengeToken: string): string {
  const base = c.env.ADMIN_PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('ADMIN_PUBLIC_URL is not configured');
  const url = new URL(`${base}/login/two-factor`);
  url.hash = new URLSearchParams({ lh_2fa: challengeToken }).toString();
  return url.toString();
}
