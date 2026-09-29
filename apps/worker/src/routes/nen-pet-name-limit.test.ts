import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { NEN_PET_NAME_MAX_LENGTH } from '@line-crm/shared';

/*
 * ペットの名前はNEN配信の本文へ差し込まれる（{{pet_name}}）。無制限だと
 * 保存時の上限判定（#659）の前提「差し込み値の最悪の長さは有限」が崩れる
 * ため、サーバ側で有限の上限を持たせている。ここではその境界だけを見る。
 */

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  syncNenPetTags: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: mocks.syncNenPetTags }));

const { nenCampaigns } = await import('./nen-campaigns.js');

function fakeDb() {
  const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  const first = vi.fn().mockResolvedValue({ id: 'friend-a', line_account_id: 'account-a', friend_id: 'friend-a' });
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare } as unknown as D1Database;
}

function app(db: D1Database) {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function postPet(name: string, db: D1Database) {
  return app(db).request('/api/nen-campaigns/pets?lineAccountId=account-a', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ friendId: 'friend-a', name }),
  });
}

function putPet(name: string, db: D1Database) {
  return app(db).request('/api/nen-campaigns/pets/pet-a?lineAccountId=account-a', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.syncNenPetTags.mockResolvedValue(undefined);
});

describe('ペット名の保存上限（#659 差し戻し1点目: 差し込み値の最悪長を有限にする）', () => {
  test(`上限ちょうど（${NEN_PET_NAME_MAX_LENGTH}字）は登録できる`, async () => {
    const response = await postPet('あ'.repeat(NEN_PET_NAME_MAX_LENGTH), fakeDb());
    expect(response.status).toBe(201);
  });

  test('上限の1字超えは拒否し、登録しない', async () => {
    const db = fakeDb();
    const response = await postPet('あ'.repeat(NEN_PET_NAME_MAX_LENGTH + 1), db);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining(`${NEN_PET_NAME_MAX_LENGTH}字以内`) });
    // INSERT文へは進んでいない（friend確認のprepareより後の呼び出しがない）。
    expect((db.prepare as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  test('更新（PUT）でも同じ上限が効く', async () => {
    const db = fakeDb();
    const response = await putPet('あ'.repeat(NEN_PET_NAME_MAX_LENGTH + 1), db);
    expect(response.status).toBe(400);
    expect((db.prepare as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  test('絵文字を含む名前もUTF-16 code unitで数える', async () => {
    // 🌿はUTF-16で2字。20回で40字ちょうど（上限）。
    const response = await postPet('🌿'.repeat(NEN_PET_NAME_MAX_LENGTH / 2), fakeDb());
    expect(response.status).toBe(201);
    const overResponse = await postPet('🌿'.repeat(NEN_PET_NAME_MAX_LENGTH / 2 + 1), fakeDb());
    expect(overResponse.status).toBe(400);
  });
});
