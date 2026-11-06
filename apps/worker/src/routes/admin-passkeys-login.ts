import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { getStaffById, getTwoFactorChallenge, clearAuthThrottle } from '@line-crm/db';
import { Hono, type Context } from 'hono';
import type { Env } from '../worker-env.js';
import { sha256Hex } from '../middleware/auth.js';
import { fail } from '../lib/fail.js';
import { inputJsonBoundary, validatedInputBody } from '../lib/input-errors.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';
import { issueSession, recordSuccessfulLoginAudit } from '../services/admin-session.js';
import { consumeMfaChallenge, mfaAudit, reserveMfaAttempt } from '../services/login-mfa.js';
import { consumeChallenge, createChallenge, relyingParty } from './admin-passkeys-self.js';

const TOKEN = /^[A-Za-z0-9_-]{30,128}$/;
const unavailable = (c: Context<Env>) => c.json({ success: false, error: 'ログインの確認ができませんでした。もう一度ログインしてください。' }, 401);

function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function primaryChallenge(c: Context<Env>, token: unknown) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const challenge = await getTwoFactorChallenge(c.env.DB, tokenHash);
  if (!challenge || challenge.purpose !== 'verify' || Date.parse(challenge.expires_at) <= Date.now() || challenge.attempts >= 5) return null;
  const staff = await getStaffById(c.env.DB, challenge.staff_id);
  if (!staff || staff.is_active !== 1 || !staff.totp_secret_enc || !staff.totp_enabled_at || staff.invite_status !== 'active' || staff.tenant_status !== 'active') return null;
  return { challenge, staff, tokenHash };
}

export const adminPasskeysLogin = new Hono<Env>();
adminPasskeysLogin.use('/api/auth/passkeys/login/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

/** Primary login is required first; this never starts a passwordless session. */
adminPasskeysLogin.post('/api/auth/passkeys/login/options', inputJsonBoundary({}, { maxBytes: 1024 }), async c => {
  const rp = relyingParty(c);
  const body = validatedInputBody(c) as { challengeToken?: string } | undefined;
  const primary = rp && await primaryChallenge(c, body?.challengeToken);
  if (!primary) return unavailable(c);
  const credentials = await c.env.DB.prepare('SELECT credential_id,transports FROM staff_passkeys WHERE staff_id=?')
    .bind(primary.staff.id).all<{ credential_id: string; transports: string }>();
  if (!credentials.results.length) return c.json({ success: true, data: { available: false } });
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID, timeout: 60_000, userVerification: 'required',
    allowCredentials: credentials.results.map(row => ({ id: row.credential_id, transports: JSON.parse(row.transports) as string[] })),
  });
  const challengeToken = await createChallenge(c, 'login', options.challenge, primary.staff.id, primary.tokenHash);
  return c.json({ success: true, data: { available: true, options, challengeToken } });
});

adminPasskeysLogin.post('/api/auth/passkeys/login/verify', inputJsonBoundary({}, { maxBytes: 131072 }), async c => {
  const rp = relyingParty(c);
  const body = validatedInputBody(c) as { loginChallengeToken?: string; challengeToken?: string; response?: AuthenticationResponseJSON } | undefined;
  const primary = rp && await primaryChallenge(c, body?.loginChallengeToken);
  if (!primary || typeof body?.challengeToken !== 'string' || !body.response || typeof body.response.id !== 'string') return unavailable(c);
  if (!await reserveMfaAttempt(c, primary.tokenHash, primary.staff.id)) {
    await mfaAudit(c, primary.staff.id, 'auth.passkey.login', 'denied');
    return c.json({ success: false, error: '入力回数を超えました。15分ほど待ってからやり直してください。' }, 429);
  }
  const challenge = await consumeChallenge(c, body.challengeToken, 'login');
  if (!challenge || challenge.staff_id !== primary.staff.id || challenge.session_token_hash !== primary.tokenHash) return unavailable(c);
  const credential = await c.env.DB.prepare(`SELECT public_key,counter,transports FROM staff_passkeys
    WHERE staff_id=? AND credential_id=?`).bind(primary.staff.id, body.response.id)
    .first<{ public_key: string; counter: number; transports: string }>();
  if (!credential) return unavailable(c);
  try {
    const result = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: challenge.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: { id: body.response.id, publicKey: decode(credential.public_key), counter: credential.counter,
        transports: JSON.parse(credential.transports) as string[] },
    });
    if (!result.verified || !result.authenticationInfo.userVerified) return unavailable(c);
    const changed = await c.env.DB.prepare(`UPDATE staff_passkeys SET counter=?,last_used_at=?
      WHERE staff_id=? AND credential_id=? AND counter=?`).bind(result.authenticationInfo.newCounter, new Date().toISOString(),
      primary.staff.id, body.response.id, credential.counter).run();
    if (changed.meta.changes !== 1 || !await consumeMfaChallenge(c.env.DB, primary.tokenHash)) return unavailable(c);
    const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
    if (config.misconfigured) return fail(c, 500, config.misconfigured);
    const session = await issueSession(c, primary.staff.id, config.sameSite, primary.challenge.remember === 1, true);
    await clearAuthThrottle(c.env.DB, `mfa:${primary.staff.id}`);
    await mfaAudit(c, primary.staff.id, 'auth.passkey.login', 'success');
    await recordSuccessfulLoginAudit(c, primary.staff.id, () => {});
    return c.json({ success: true, data: { sessionToken: config.crossSite ? session.sessionToken : undefined }, csrfToken: session.csrfToken });
  } catch {
    await mfaAudit(c, primary.staff.id, 'auth.passkey.login', 'failed');
    return unavailable(c);
  }
});
