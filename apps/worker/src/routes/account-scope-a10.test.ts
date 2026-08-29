import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { nenCampaigns } from './nen-campaigns.js';

const access = vi.hoisted(() => ({
  getScope: vi.fn(),
  canAccess: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: access.getScope,
  canAccessAllLineAccounts: access.canAccess,
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));

type Friend = { id: string; line_account_id: string; display_name: string; line_user_id: string };
type Pet = { id: string; friend_id: string; customer_id: string | null; name: string; animal_type: string; gender: string; birthday: string | null };

const friends: Friend[] = [
  { id: 'friend-a', line_account_id: 'account-a', display_name: 'Owner A', line_user_id: 'line-a' },
  { id: 'friend-a2', line_account_id: 'account-a2', display_name: 'Owner A2', line_user_id: 'line-a2' },
  { id: 'friend-b', line_account_id: 'account-b', display_name: 'Owner B', line_user_id: 'line-secret-b' },
];
let pets: Pet[];

function database(): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { binds = values; return statement; },
        async all() {
          if (!sql.includes('FROM nen_pet_profiles p JOIN friends f')) return { results: [] };
          const selectedAccountId = String(binds[0]);
          return { results: pets.filter((pet) => selectedAccountId === friends.find((f) => f.id === pet.friend_id)!.line_account_id).map((pet) => {
            const friend = friends.find((f) => f.id === pet.friend_id)!;
            return { ...pet, display_name: friend.display_name, line_user_id: friend.line_user_id };
          }) };
        },
        async first() {
          if (sql.includes('FROM friends WHERE id = ?')) return friends.find((f) => f.id === binds[0]) ?? null;
          if (sql.includes('FROM nen_pet_profiles p JOIN friends f')) {
            const pet = pets.find((p) => p.id === binds[0]);
            if (!pet) return null;
            const friend = friends.find((f) => f.id === pet.friend_id)!;
            return { friend_id: pet.friend_id, line_account_id: friend.line_account_id };
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO nen_pet_profiles')) {
            pets.push({ id: String(binds[0]), friend_id: String(binds[1]), customer_id: binds[2] as string | null, name: String(binds[3]), animal_type: String(binds[4]), gender: String(binds[5]), birthday: binds[6] as string | null });
          } else if (sql.includes('UPDATE nen_pet_profiles')) {
            const pet = pets.find((p) => p.id === binds[5]);
            if (pet) Object.assign(pet, { name: binds[0], animal_type: binds[1], gender: binds[2], birthday: binds[3] });
          } else if (sql.includes('DELETE FROM nen_pet_profiles')) {
            pets = pets.filter((p) => p.id !== binds[0]);
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app() {
  const instance = new Hono();
  instance.use('*', async (c, next) => {
    const identity = c.req.header('x-test-staff') || 'tenant-a';
    c.set('staff' as never, { id: identity, role: identity === 'scoped' ? 'staff' : 'owner', tenantId: identity } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function request(method = 'GET', body?: object, staff = 'tenant-a') {
  return { method, headers: { 'content-type': 'application/json', 'x-test-staff': staff }, body: body ? JSON.stringify(body) : undefined };
}

beforeEach(() => {
  pets = [
    { id: 'pet-a', friend_id: 'friend-a', customer_id: null, name: 'Pet A', animal_type: 'dog', gender: 'unknown', birthday: null },
    { id: 'pet-a2', friend_id: 'friend-a2', customer_id: null, name: 'Pet A2', animal_type: 'cat', gender: 'unknown', birthday: null },
    { id: 'pet-b', friend_id: 'friend-b', customer_id: null, name: 'Pet B', animal_type: 'dog', gender: 'unknown', birthday: null },
  ];
  const allowed = (staff: { id: string }) => staff.id === 'tenant-b' ? ['account-b'] : ['account-a'];
  access.getScope.mockImplementation(async (_db, staff) => ({ allowedAccountIds: allowed(staff), canSeeUnassigned: false }));
  access.canAccess.mockImplementation(async (_db, staff, ids) => ids.every((id: string) => allowed(staff).includes(id)));
});

describe('A-10 NEN pet account scope', () => {
  test('lists only pets in the tenant and never leaks another tenant line user ID', async () => {
    const response = await app().request('/api/nen-campaigns/pets?lineAccountId=account-a', request('GET', undefined, 'tenant-a'), { DB: database() });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('line-a');
    expect(text).not.toContain('line-secret-b');
    expect(text).not.toContain('Pet B');
  });

  test('account-scoped staff cannot list pets outside the assigned account', async () => {
    const response = await app().request('/api/nen-campaigns/pets?lineAccountId=account-a', request('GET', undefined, 'scoped'), { DB: database() });
    const data = await response.json<{ data: Array<{ id: string }> }>();
    expect(data.data.map((pet) => pet.id)).toEqual(['pet-a']);
  });

  test.each([['PUT', { name: 'Changed' }], ['DELETE', undefined]] as const)('%s hides and preserves another tenant pet', async (method, body) => {
    const response = await app().request('/api/nen-campaigns/pets/pet-b?lineAccountId=account-a', request(method, body, 'tenant-a'), { DB: database() });
    expect(response.status).toBe(404);
    expect(pets.find((pet) => pet.id === 'pet-b')?.name).toBe('Pet B');
  });

  test('POST hides another tenant friend and creates no row', async () => {
    const before = pets.length;
    const response = await app().request('/api/nen-campaigns/pets?lineAccountId=account-a', request('POST', { friendId: 'friend-b', name: 'Blocked' }), { DB: database() });
    expect(response.status).toBe(404);
    expect(pets).toHaveLength(before);
  });

  test('list, create, update, and delete continue to work inside the visible account', async () => {
    const instance = app();
    const env = { DB: database() };
    expect((await instance.request('/api/nen-campaigns/pets?lineAccountId=account-a', request(), env)).status).toBe(200);
    const created = await instance.request('/api/nen-campaigns/pets?lineAccountId=account-a', request('POST', { friendId: 'friend-a', name: 'New Pet' }), env);
    expect(created.status).toBe(201);
    const { data } = await created.json<{ data: { id: string } }>();
    expect((await instance.request(`/api/nen-campaigns/pets/${data.id}?lineAccountId=account-a`, request('PUT', { name: 'Updated Pet' }), env)).status).toBe(200);
    expect(pets.find((pet) => pet.id === data.id)?.name).toBe('Updated Pet');
    expect((await instance.request(`/api/nen-campaigns/pets/${data.id}?lineAccountId=account-a`, request('DELETE'), env)).status).toBe(200);
    expect(pets.some((pet) => pet.id === data.id)).toBe(false);
  });
});
