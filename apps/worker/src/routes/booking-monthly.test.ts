import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./booking.js', () => ({
  resolveAccountIdFromLiff: async () => 'a',
  verifyCallerLineUserId: async () => identity.user,
  resolveFriendId: async (_c: unknown, user: string) => user === 'Uf' ? 'f' : 'f2',
}));
const identity = vi.hoisted(() => ({ user: 'Uf' as string | null }));
import { bookingMonthly } from './booking-monthly.js';
import { gapApp, gapCall, gapOwner } from '../test-utils/gap1.js';
import { monthlyFixture, monthlyContract } from '../test-utils/monthly-ledger.js';
import type { SqliteD1 } from '../test-utils/d1-sqlite.js';

let d: SqliteD1;
beforeEach(async () => { d = monthlyFixture(); await monthlyContract(d); identity.user = 'Uf'; });
afterEach(() => d.raw.close());
it('管理者と閲覧のみは読めるが、別店・別本人の指定は返さない', async () => {
  const app = gapApp(d, [bookingMonthly], { ...gapOwner, readOnly: true });
  const response = await gapCall(app, '/api/booking/admin/monthly-contracts?account_id=a&friend_id=f');
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect((await response.json() as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  expect((await gapCall(app, '/api/booking/admin/monthly-contracts?account_id=b&friend_id=f')).status).toBe(404);
  expect((await gapCall(app, '/api/booking/admin/monthly-contracts?account_id=a&friend_id=unknown')).status).toBe(404);
});
it('画面権限なしの担当者は読めない', async () => {
  const app = gapApp(d, [bookingMonthly], { ...gapOwner, id: 's', role: 'staff', permissionKeys: [], viewPermissionKeys: [] });
  expect((await gapCall(app, '/api/booking/admin/monthly-contracts?account_id=a&friend_id=f')).status).toBe(403);
});
it('LIFFは本人だけ、クエリのfriend_idでは他人へ切り替わらない', async () => {
  const app = gapApp(d, [bookingMonthly]);
  identity.user = 'Uf2';
  const response = await gapCall(app, '/api/liff/booking/monthly-contracts?friend_id=f');
  expect(response.status).toBe(200); expect((await response.json() as { data: { items: unknown[] } }).data.items).toEqual([]);
  identity.user = null;
  expect((await gapCall(app, '/api/liff/booking/monthly-contracts')).status).toBe(401);
});
it('会社未設定は明示コードと案内、旧券を書き換えない', async () => {
  d.raw.pragma('foreign_keys=OFF');
  d.raw.exec("UPDATE line_accounts SET tenant_id=NULL WHERE id='a'");
  const response = await gapCall(gapApp(d, [bookingMonthly]), '/api/liff/booking/monthly-contracts');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'monthly_tenant_required', message: expect.stringContaining('運営にお問い合わせください') });
  expect(d.raw.prepare('SELECT state FROM booking_monthly_contracts').get()).toEqual({ state: 'applying' });
});
it('不正ページ指定・未実装の書込は副作用なく拒否', async () => {
  const app = gapApp(d, [bookingMonthly]);
  expect((await gapCall(app, '/api/liff/booking/monthly-contracts?limit=51')).status).toBe(400);
  expect((await gapCall(app, '/api/liff/booking/monthly-contracts', 'POST', {})).status).toBe(404);
  expect(d.raw.prepare('SELECT count(*) n FROM booking_monthly_contracts').get()).toEqual({ n: 1 });
});
