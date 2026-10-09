import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { entryRoutes } from './entry-routes.js';
import { liffRoutes } from './liff.js';

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: async (auth?: string) => auth === 'Bearer valid' ? { lineUserId: 'u', lineAccountId: 'a' } : null,
  verifyCallerLineUserId: vi.fn(),
}));
vi.mock('../services/request-boundary.js', () => ({
  resolveRequestBoundary: async (_db: unknown, _staff: unknown, account?: string) => ({ allowed: account === 'a', scope: { canSeeUnassigned: false, allowedAccountIds: ['a'] } }),
}));

let test: SqliteD1;
let app: Hono<Env>;
const payload = { description: '500円引き', startsAt: '2026-01-01', endsAt: '2099-01-01', oncePerFriend: true };
beforeEach(() => {
  test = createTestD1();
  test.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('a','店','ch','token','secret');
    INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','u','a',1);
    INSERT INTO entry_routes(id,ref_code,name,line_account_id,coupon_enabled,coupon_audience) VALUES('r','qr','店頭','a',1,'all_friends');`);
  test.raw.prepare(`INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at)
    VALUES('c','a','coupon','割引',?,1,'2026-10-01','2026-10-01')`).run(JSON.stringify(payload));
  test.raw.exec("UPDATE entry_routes SET coupon_asset_id='c' WHERE id='r'");
  app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 's', name: '担当', role: 'owner', readOnly: false });
    return next();
  });
  app.route('/', entryRoutes);
  app.route('/', liffRoutes);
});
afterEach(() => test.raw.close());
function request(path: string, body?: unknown, method = 'POST', auth?: string) {
  return app.request(`https://worker.example${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, { DB: test.db } as Env['Bindings']);
}

describe('クーポンQRのHTTP境界', () => {
  it('クーポン設定を保存・取得・停止し、無効な設定は保存しない', async () => {
    const input = { refCode: 'new', name: '新しい経路', lineAccountId: 'a', couponAssetId: 'c', couponEnabled: true, couponAudience: 'new_friends' };
    const created = await request('/api/entry-routes', input);
    expect(created.status).toBe(201);
    const row = (await created.json() as { data: { id: string } }).data;
    expect((await (await request(`/api/entry-routes/${row.id}`, undefined, 'GET')).json() as { data: unknown }).data)
      .toMatchObject({ couponAssetId: 'c', couponEnabled: true, couponAudience: 'new_friends' });
    expect((await request('/api/entry-routes', { ...input, refCode: 'invalid', couponAudience: 'everyone' })).status).toBe(400);
    expect((await request('/api/entry-routes', { ...input, refCode: 'missing', couponAssetId: null })).status).toBe(400);
    test.raw.exec('UPDATE broadcast_message_assets SET published_version=0');
    expect((await request('/api/entry-routes', { ...input, refCode: 'stopped' })).status).toBe(400);
    expect((await request(`/api/entry-routes/${row.id}`, { couponEnabled: false, couponAssetId: 'c' }, 'PATCH')).status).toBe(200);
    expect((await request(`/api/entry-routes/${row.id}`, { couponEnabled: true, couponAssetId: 'c' }, 'PATCH')).status).toBe(400);
    expect(test.raw.prepare("SELECT COUNT(*) AS n FROM entry_routes WHERE ref_code IN ('invalid','missing','stopped')").get()).toEqual({ n: 0 });
  });

  it('本人確認した友だちだけ受け取れ、繰り返しは同じID。停止・未公開・別account・未フォローは拒否', async () => {
    expect((await request('/api/liff/entry-route-coupon', { ref: 'qr' })).status).toBe(401);
    const first = await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid');
    expect(first.status).toBe(200);
    const second = await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid');
    expect(await second.json()).toEqual(await first.json());
    test.raw.exec('UPDATE entry_routes SET is_active=0');
    expect((await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid')).status).toBe(404);
    test.raw.exec('UPDATE entry_routes SET is_active=1; UPDATE broadcast_message_assets SET published_version=0');
    expect((await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid')).status).toBe(409);
    test.raw.exec("UPDATE broadcast_message_assets SET published_version=1; UPDATE entry_routes SET line_account_id='other'");
    expect((await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid')).status).toBe(404);
    test.raw.exec("UPDATE entry_routes SET line_account_id='a'; UPDATE friends SET is_following=0");
    expect((await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid')).status).toBe(409);
    expect(test.raw.prepare('SELECT COUNT(*) AS n FROM entry_route_coupon_receipts').get()).toEqual({ n: 1 });
  });

  it('LIFFの使用は本人の受け取りだけ。再試行は同じ結果、別操作は回数の上限で拒む', async () => {
    const received = await request('/api/liff/entry-route-coupon', { ref: 'qr' }, 'POST', 'Bearer valid');
    const { data } = await received.json() as { data: { receiptId: string } };
    const body = { receiptId: data.receiptId, requestId: 'use-1' };
    expect((await request('/api/liff/entry-route-coupon/use', body)).status).toBe(401);
    expect((await request('/api/liff/entry-route-coupon/use', { ...body, receiptId: 'other' }, 'POST', 'Bearer valid')).status).toBe(404);
    expect((await request('/api/liff/entry-route-coupon/use', body, 'POST', 'Bearer valid')).status).toBe(200);
    const retried = await request('/api/liff/entry-route-coupon/use', body, 'POST', 'Bearer valid');
    expect(await retried.json()).toMatchObject({ success: true, data: { replayed: true } });
    expect((await request('/api/liff/entry-route-coupon/use', { ...body, requestId: 'use-2' }, 'POST', 'Bearer valid')).status).toBe(409);
    expect(test.raw.prepare('SELECT entry_route_coupon_receipt_id FROM coupon_redemptions').all()).toEqual([{ entry_route_coupon_receipt_id: data.receiptId }]);
  });

  it('PNG/SVGの実寸とA4/A5を出し、停止時・不正形式・所属違いは書き出さない', async () => {
    for (const [size, pixels] of [['small', 256], ['medium', 512], ['large', 1024]] as const) {
      const png = await request('/api/entry-routes/r/qr-image', { format: 'png', size });
      expect(png.status).toBe(200);
      const bytes = new Uint8Array(await png.arrayBuffer());
      const view = new DataView(bytes.buffer);
      expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(view.getUint32(16)).toBe(pixels);
      expect(view.getUint32(20)).toBe(pixels);
    }
    const svg = await request('/api/entry-routes/r/qr-image', { format: 'svg', size: 'medium' });
    expect(svg.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await svg.text()).toContain('width="512"');
    for (const [paper, box] of [['A4', '595.28 841.89'], ['A5', '419.53 595.28']] as const) {
      const pdf = await request('/api/entry-routes/r/qr-pdf', { paper });
      expect(pdf.status).toBe(200);
      expect(await pdf.text()).toContain(`/MediaBox [0 0 ${box}]`);
    }
    expect((await request('/api/entry-routes/r/qr-image', { format: 'jpg' })).status).toBe(400);
    expect((await request('/api/entry-routes/r/qr-pdf', { paper: 'A3' })).status).toBe(400);
    test.raw.exec('UPDATE entry_routes SET is_active=0');
    expect((await request('/api/entry-routes/r/qr-image', {})).status).toBe(409);
    test.raw.exec("UPDATE entry_routes SET is_active=1,line_account_id='other'");
    expect((await request('/api/entry-routes/r/qr-image', {})).status).toBe(404);
    expect((await request('/api/entry-routes/r/funnel', undefined, 'GET')).status).toBe(404);
  });
});
