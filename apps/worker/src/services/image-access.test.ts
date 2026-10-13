import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { privateImageResponseMiddleware, privateImageSignatureValid, signPrivateImageUrl } from './image-access.js';

const { scope, identity } = vi.hoisted(() => ({ scope: vi.fn(), identity: vi.fn() }));
vi.mock('./account-access.js', () => ({ getVisibleLineAccountScope: scope }));
vi.mock('./liff-auth.js', () => ({ verifyCallerLineIdentity: identity }));
const origin = 'https://synthetic.invalid';
const image = `${origin}/images/nen-pet-profiles/synthetic-friend/pet.jpg`;
const secret = 'synthetic-signing-key';

describe('S11 private image capabilities', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T09:00:00Z')); scope.mockResolvedValue({ ids: ['own-account'] }); identity.mockResolvedValue(null); });
  afterEach(() => vi.useRealTimers());

  it('binds the signature to the key and expiry and expires in five minutes', async () => {
    const signed = new URL(await signPrivateImageUrl(new URL(image), secret));
    expect(await privateImageSignatureValid(signed, secret)).toBe(true);
    const changedKey = new URL(signed); changedKey.pathname = changedKey.pathname.replace('pet.jpg', 'other.jpg');
    expect(await privateImageSignatureValid(changedKey, secret)).toBe(false);
    const changedExpiry = new URL(signed); changedExpiry.searchParams.set('expires', String(Number(signed.searchParams.get('expires')) + 1));
    expect(await privateImageSignatureValid(changedExpiry, secret)).toBe(false);
    expect(await privateImageSignatureValid(signed, 'different-key')).toBe(false);
    vi.advanceTimersByTime(300_000);
    expect(await privateImageSignatureValid(signed, secret)).toBe(false);
  });

  it.each([new URL(image), new URL(`${image}?expires=1&signature=invalid`)])('rejects missing or malformed capabilities', async url => {
    expect(await privateImageSignatureValid(url, secret)).toBe(false);
  });

  function response(staff: boolean, account = 'own-account', source = image, exists = true) {
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      if (staff) c.set('staff', { id: 'synthetic-staff', name: 'Synthetic', role: 'staff', readOnly: false, tenantId: 'synthetic-tenant' });
      await next();
    });
    app.use('*', privateImageResponseMiddleware);
    app.get('/api/test', c => c.json({ data: [{ photoUrl: source }] }));
    return app.request('/api/test', {}, { API_KEY: secret, WORKER_PUBLIC_URL: origin,
      IMAGES: { head: async () => exists ? { customMetadata: { friendId: 'synthetic-friend' } } : null },
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ line_account_id: account, line_user_id: 'own-user' }) }) }) },
    } as unknown as Env['Bindings']);
  }

  async function urlOf(res: Response) { return (await res.json() as { data: { photoUrl: string }[] }).data[0].photoUrl; }

  it('issues a fresh uncached URL for an authorized staff member', async () => {
    const res = await response(true);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await privateImageSignatureValid(new URL(await urlOf(res)), secret)).toBe(true);
  });
  it('cannot issue a URL for a different account or a deleted object', async () => {
    expect(await urlOf(await response(true, 'foreign-account'))).toBe(image);
    expect(await urlOf(await response(true, 'own-account', image, false))).toBe(image);
  });
  it('requires a verified LIFF identity matching both friend and account', async () => {
    expect(await urlOf(await response(false))).toBe(image);
    identity.mockResolvedValue({ lineAccountId: 'foreign-account', lineUserId: 'own-user' });
    expect(await urlOf(await response(false))).toBe(image);
    identity.mockResolvedValue({ lineAccountId: 'own-account', lineUserId: 'other-user' });
    expect(await urlOf(await response(false))).toBe(image);
    identity.mockResolvedValue({ lineAccountId: 'own-account', lineUserId: 'own-user' });
    expect(await privateImageSignatureValid(new URL(await urlOf(await response(false))), secret)).toBe(true);
  });
  it('never signs another origin or public layout images', async () => {
    for (const source of [image.replace(origin, 'https://other.invalid'), `${origin}/images/media/layout.png`]) {
      expect(await urlOf(await response(true, 'own-account', source))).toBe(source);
    }
  });
});
