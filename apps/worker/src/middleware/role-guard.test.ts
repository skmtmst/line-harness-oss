import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../index.js';
import { denyReadOnly, requireIrreversibleConfirmation, requireRole } from './role-guard.js';

/**
 * 役割と読み取り専用を分けたあとの権限判定。
 *
 * 見たいのは3つ:
 *   - 役割で通る／通らないが正しいこと
 *   - 読み取り専用でも「役割としては通る」こと（更新は別の層で止める）
 *   - 鍵情報のように、読み取り専用を明示的に止めたい経路が止まること
 */

type Staff = { id: string; name: string; role: 'owner' | 'admin' | 'staff'; readOnly: boolean };

function appWith(staff: Staff | null, guards: Array<ReturnType<typeof requireRole>>) {
  const app = new Hono<Env>();
  app.use('/x', async (c, next) => {
    if (staff) c.set('staff', staff);
    return next();
  });
  for (const guard of guards) app.use('/x', guard);
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
}

async function status(staff: Staff | null, guards: Array<ReturnType<typeof requireRole>>) {
  const res = await appWith(staff, guards).request('/x');
  return res.status;
}

const owner: Staff = { id: '1', name: 'O', role: 'owner', readOnly: false };
const admin: Staff = { id: '2', name: 'A', role: 'admin', readOnly: false };
const staffUser: Staff = { id: '3', name: 'S', role: 'staff', readOnly: false };

describe('requireRole', () => {
  it('許可された役割は通る', async () => {
    expect(await status(owner, [requireRole('owner')])).toBe(200);
    expect(await status(admin, [requireRole('owner', 'admin')])).toBe(200);
    expect(await status(staffUser, [requireRole('owner', 'admin', 'staff')])).toBe(200);
  });

  it('許可されていない役割は403', async () => {
    expect(await status(admin, [requireRole('owner')])).toBe(403);
    expect(await status(staffUser, [requireRole('owner', 'admin')])).toBe(403);
  });

  it('認証されていなければ403', async () => {
    expect(await status(null, [requireRole('owner')])).toBe(403);
  });

  it('読み取り専用でも役割としては通る（更新は別の層で止める）', async () => {
    const readOnlyOwner: Staff = { ...owner, readOnly: true };
    expect(await status(readOnlyOwner, [requireRole('owner')])).toBe(200);
  });

  it('役割が足りなければ、読み取り専用かどうかに関係なく止まる', async () => {
    const readOnlyStaff: Staff = { ...staffUser, readOnly: true };
    expect(await status(readOnlyStaff, [requireRole('owner')])).toBe(403);
  });
});

describe('denyReadOnly', () => {
  it('読み取り専用は役割にかかわらず止まる', async () => {
    for (const base of [owner, admin, staffUser]) {
      expect(await status({ ...base, readOnly: true }, [denyReadOnly()])).toBe(403);
    }
  });

  it('読み取り専用でなければ通る', async () => {
    for (const base of [owner, admin, staffUser]) {
      expect(await status(base, [denyReadOnly()])).toBe(200);
    }
  });

  it('requireRole と重ねると、役割と読み取り専用の両方を満たす人だけ通る', async () => {
    const guards = [requireRole('owner'), denyReadOnly()];
    expect(await status(owner, guards)).toBe(200);
    // 閲覧のみのオーナーには鍵情報を見せない
    expect(await status({ ...owner, readOnly: true }, guards)).toBe(403);
    // 役割が足りない
    expect(await status(admin, guards)).toBe(403);
  });
});

describe('requireIrreversibleConfirmation', () => {
  function app(header?: string) {
    const a = new Hono<Env>();
    a.use('/x', async (c, next) => {
      c.set('staff', owner);
      return next();
    });
    a.use('/x', requireIrreversibleConfirmation('broadcast-send'));
    a.post('/x', (c) => c.json({ ok: true }));
    return a.request('/x', { method: 'POST', headers: header ? { 'X-Confirm-Irreversible': header } : {} });
  }

  it('確認ヘッダが無ければ 428 で止める', async () => {
    const res = await app();
    expect(res.status).toBe(428);
    expect((await res.json() as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
  });

  it('合言葉が違えば止める（たまたま付いていた、では通さない）', async () => {
    expect((await app('yes')).status).toBe(428);
    expect((await app('true')).status).toBe(428);
    expect((await app('scenario-send')).status).toBe(428);
  });

  it('正しい合言葉なら通る', async () => {
    expect((await app('broadcast-send')).status).toBe(200);
  });
});
