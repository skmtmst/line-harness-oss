import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { getStaffById, recordAuditEvent } from '@line-crm/db';
import { Hono, type Context } from 'hono';
import type { Env } from '../worker-env.js';
import { adminSessionTokenHashFromRequest, sha256Hex } from '../middleware/auth.js';
import { randomToken } from '../services/admin-session.js';
import { consumeStepUpToken, stepUpRequiredResponse } from '../lib/step-up.js';
import { getActiveImpersonation } from '@line-crm/db';
import { inputJsonBoundary, readBoundedText, validatedInputBody } from '../lib/input-errors.js';

/** WebAuthn runs on the canonical admin origin, not on the separate API origin. */
function relyingParty(c: Context<Env>): { origin: string; rpID: string } | null {
  try {
    const configured = new URL(c.env.ADMIN_PUBLIC_URL ?? '');
    if (configured.protocol !== 'https:' && configured.hostname !== 'localhost') return null;
    if (c.req.header('Origin') !== configured.origin) return null;
    return { origin: configured.origin, rpID: configured.hostname };
  } catch { return null; }
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function invalid(c: Context<Env>) {
  return c.json({ success: false, error: 'パスキーの確認に失敗しました。もう一度お試しください。' }, 401);
}
async function currentOwner(c: Context<Env>) {
  const principal = c.get('staff');
  const sessionHash = await adminSessionTokenHashFromRequest(c);
  if (!principal || principal.id === 'env-owner' || principal.readOnly || !sessionHash || c.get('impersonation')) return null;
  if (await getActiveImpersonation(c.env.DB, principal.id, sessionHash)) return null;
  const staff = await getStaffById(c.env.DB, principal.id);
  if (!staff || staff.is_active !== 1 || staff.invite_status !== 'active' || staff.tenant_status !== 'active') return null;
  return { staff, sessionHash };
}

type Challenge = { challenge: string; purpose: 'register'; staff_id: string | null; session_token_hash: string | null };
async function createChallenge(c: Context<Env>, purpose: Challenge['purpose'], challenge: string, staffId: string | null, sessionHash: string | null) {
  const token = randomToken();
  const now = new Date();
  await c.env.DB.prepare('DELETE FROM staff_passkey_challenges WHERE expires_at<=?').bind(now.toISOString()).run();
  await c.env.DB.prepare(`INSERT INTO staff_passkey_challenges(token_hash,challenge,purpose,staff_id,session_token_hash,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?)`).bind(await sha256Hex(token), challenge, purpose, staffId, sessionHash,
    new Date(now.getTime() + 5 * 60_000).toISOString(), now.toISOString()).run();
  return token;
}
async function consumeChallenge(c: Context<Env>, token: string, purpose: Challenge['purpose']): Promise<Challenge | null> {
  if (!/^[A-Za-z0-9_-]{30,128}$/.test(token)) return null;
  return c.env.DB.prepare(`DELETE FROM staff_passkey_challenges WHERE token_hash=? AND purpose=? AND expires_at>?
    RETURNING challenge,purpose,staff_id,session_token_hash`).bind(await sha256Hex(token), purpose, new Date().toISOString()).first<Challenge>();
}

export const adminPasskeysSelf = new Hono<Env>();
adminPasskeysSelf.use('/api/auth/passkeys/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

adminPasskeysSelf.get('/api/auth/passkeys/self', async c => {
  const owner = await currentOwner(c);
  if (!owner) return c.json({ success: false, error: '本人のログインで開いてください' }, 403);
  const rows = await c.env.DB.prepare(`SELECT credential_id,created_at,last_used_at FROM staff_passkeys
    WHERE staff_id=? ORDER BY created_at DESC`).bind(owner.staff.id).all<{ credential_id: string; created_at: string; last_used_at: string | null }>();
  return c.json({ success: true, data: rows.results.map(row => ({ id: row.credential_id, createdAt: row.created_at, lastUsedAt: row.last_used_at })) });
});

adminPasskeysSelf.post('/api/auth/passkeys/register/options', inputJsonBoundary({}, { maxBytes: 1024 }), async c => {
  const rp = relyingParty(c);
  const owner = await currentOwner(c);
  if (!rp || !owner) return c.json({ success: false, error: 'この画面から本人のログインで操作してください' }, 403);
  if (!owner.staff.totp_enabled_at || !owner.staff.totp_secret_enc) return c.json({ success: false, error: '先に認証アプリを登録してください' }, 400);
  const existing = await c.env.DB.prepare('SELECT credential_id,transports FROM staff_passkeys WHERE staff_id=?').bind(owner.staff.id).all<{ credential_id: string; transports: string }>();
  if (existing.results.length >= 10) return c.json({ success: false, error: 'パスキーは10個まで登録できます' }, 409);
  const options = await generateRegistrationOptions({
    rpName: 'musubo', rpID: rp.rpID, userName: owner.staff.email ?? owner.staff.name,
    userDisplayName: owner.staff.name, userID: new TextEncoder().encode(owner.staff.id) as Uint8Array<ArrayBuffer>,
    attestationType: 'none', timeout: 60_000,
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: existing.results.map(row => ({ id: row.credential_id, transports: JSON.parse(row.transports) as string[] })),
  });
  const challengeToken = await createChallenge(c, 'register', options.challenge, owner.staff.id, owner.sessionHash);
  return c.json({ success: true, data: { options, challengeToken } });
});

adminPasskeysSelf.post('/api/auth/passkeys/register/verify', inputJsonBoundary({}, { maxBytes: 131072 }), async c => {
  const rp = relyingParty(c);
  const owner = await currentOwner(c);
  if (!rp || !owner) return c.json({ success: false, error: 'この画面から本人のログインで操作してください' }, 403);
  const body = validatedInputBody(c) as { challengeToken?: string; response?: RegistrationResponseJSON } | undefined;
  if (!body?.challengeToken || !body.response || typeof body.response.id !== 'string') return invalid(c);
  const challenge = await consumeChallenge(c, body.challengeToken, 'register');
  if (!challenge || challenge.staff_id !== owner.staff.id || challenge.session_token_hash !== owner.sessionHash) return invalid(c);
  try {
    const result = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true });
    if (!result.verified || !result.registrationInfo.userVerified) return invalid(c);
    if (!await consumeStepUpToken(c, 'auth.passkey.register')) return stepUpRequiredResponse(c, 'パスキー登録前に本人確認してください');
    const info = result.registrationInfo;
    const stored = await c.env.DB.prepare(`INSERT OR IGNORE INTO staff_passkeys
      (credential_id,staff_id,public_key,counter,transports,device_type,backed_up,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM staff_passkeys WHERE staff_id=?)<10`).bind(
      info.credential.id, owner.staff.id, encode(info.credential.publicKey), info.credential.counter,
      JSON.stringify(info.credential.transports ?? []), info.credentialDeviceType, info.credentialBackedUp ? 1 : 0,
      new Date().toISOString(), owner.staff.id).run();
    if (stored.meta.changes !== 1) return c.json({ success: false, error: '登録済みか、登録数の上限です' }, 409);
    await recordAuditEvent(c.env.DB, { category: 'auth', action: 'auth.passkey.register', actorPrincipalId: owner.staff.id,
      actorRole: owner.staff.role, tenantId: owner.staff.tenant_id, targetKind: 'staff', targetId: owner.staff.id,
      result: 'success', riskLevel: 'high', retentionClass: 'security' });
    return c.json({ success: true, data: { id: info.credential.id } });
  } catch { return invalid(c); }
});

adminPasskeysSelf.delete('/api/auth/passkeys/self', async c => {
  if (!relyingParty(c)) return c.json({ success: false, error: '管理画面からお試しください' }, 403);
  const owner = await currentOwner(c);
  if (!owner) return c.json({ success: false, error: '本人のログインで操作してください' }, 403);
  let body: { id?: unknown };
  try {
    const text = await readBoundedText(c.req.raw, 1024);
    if (text === null) return c.json({ success: false, error: '送信内容が大きすぎます' }, 413);
    body = JSON.parse(text || '{}') as { id?: unknown };
  } catch { return c.json({ success: false, error: '送信内容を確認してください' }, 400); }
  if (!body || typeof body.id !== 'string' || !body.id || body.id.length > 1024) return c.json({ success: false, error: '削除するパスキーを選んでください' }, 400);
  if (!await consumeStepUpToken(c, 'auth.passkey.remove')) return stepUpRequiredResponse(c, '削除前に本人確認してください');
  const deleted = await c.env.DB.prepare('DELETE FROM staff_passkeys WHERE staff_id=? AND credential_id=? RETURNING credential_id')
    .bind(owner.staff.id, body.id).first();
  if (!deleted) return c.json({ success: false, error: 'パスキーが見つかりません' }, 404);
  await recordAuditEvent(c.env.DB, { category: 'auth', action: 'auth.passkey.remove', actorPrincipalId: owner.staff.id,
    actorRole: owner.staff.role, tenantId: owner.staff.tenant_id, targetKind: 'staff', targetId: owner.staff.id,
    result: 'success', riskLevel: 'high', retentionClass: 'security' });
  return c.json({ success: true });
});
