import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asD1 } from '@line-crm/db/test/d1-test-helper.js';
import { getMediaDeleteImpactSnapshot, getMediaReplacementPlan } from '@line-crm/db';
import { scanMediaUsage, scanSingleMediaUsage } from '../features/media/media-usage-scan.js';
import type { Env } from '../worker-env.js';
import { permissionForApiPath } from '../middleware/auth.js';

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(id => id === 'a') }));
const { default: booking } = await import('./booking.js');
const { contents } = await import('./contents.js');
let raw: Database.Database;
let db: D1Database;
let app: Hono<Env>;
let staff: Env['Variables']['staff'];
const order = ['exterior', 'interior', 'waiting'];

/** D1 の位置引数 ?1/?2 を better-sqlite3 の引数形式へ展開し、製品 SQL を変えずに試す。 */
function testD1(sqlite: Database.Database): D1Database {
  const base = asD1(sqlite);
  return { ...base, prepare(query: string) {
    const slots = [...query.matchAll(/\?(\d+)/g)].map(match => Number(match[1]) - 1);
    if (slots.length === 0) return base.prepare(query);
    const statement = base.prepare(query.replace(/\?\d+/g, '?'));
    return { ...statement, bind: (...values: unknown[]) => statement.bind(...slots.map(index => values[index])) } as D1PreparedStatement;
  } } as D1Database;
}

beforeEach(() => {
  raw = new Database(':memory:');
  raw.pragma('foreign_keys=ON');
  raw.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,liff_id) VALUES
    ('a','ca','A店','t','s','la'),('b','cb','B店','t','s','lb');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES ('m','a','カット',30,1000),('mb','b','別店',30,1000);
    INSERT INTO staff(id,line_account_id,name,display_name) VALUES ('s','a','担当','担当'),('sb','b','別店担当','別店担当');
    INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES ('s','m',1);
    INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,created_at,archived_at) VALUES
      ('p','a','image','外観.jpg','image/jpeg',10,'photos/p','2026-01-01',NULL),
      ('p-more','a','image','店内.jpg','image/jpeg',10,'photos/more','2026-01-01',NULL),
      ('other','b','image','別店.jpg','image/jpeg',10,'photos/other','2026-01-01',NULL),
      ('shared',NULL,'image','共有.jpg','image/jpeg',10,'photos/shared','2026-01-01',NULL),
      ('archived','a','image','退避.jpg','image/jpeg',10,'photos/archived','2026-01-01','2026-02-01'),
      ('video','a','video','動画.mp4','video/mp4',10,'photos/video','2026-01-01',NULL);`);
  db = testD1(raw);
  staff = { id: 'owner', name: '担当', role: 'owner', readOnly: false };
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', staff); await next(); });
  app.route('/', booking);
  app.route('/', contents);
});
afterEach(() => raw.close());

function request(path: string, body?: unknown, account = 'a') {
  return app.request(`${path}?account_id=${account}`, body === undefined ? {} : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings']);
}
const menuSave = (mediaId: unknown, expectedVersion = 1, id = 'm') => request(`/api/booking/admin/menus/${id}/photo`, { mediaId, expectedVersion });
const storeSave = (photos: unknown, expectedVersion = 0, photoOrder: unknown = order, visibility: unknown = { exterior: true, interior: true, waiting: true }) => request('/api/booking/admin/store-photos', { photos, order: photoOrder, expectedVersion, visibility });
const photos = (exterior: string | null = 'p', interior: string | null = null, waiting: string | null = null) => ({ exterior, interior, waiting });

describe('予約写真：実HTTP・実SQLite・使用台帳', () => {
  it('写真の読み口は現在のメニュー閲覧の鍵を使い、編集の鍵は広げない', () => {
    expect(permissionForApiPath('/api/booking/admin/menus/photos')).toBe('/booking/menus');
    expect(permissionForApiPath('/api/booking/admin/menus/m/photo')).toBe('/booking/menus');
    expect(permissionForApiPath('/api/booking/admin/staff/s/photo')).toBe('/booking/bookings');
    expect(permissionForApiPath('/api/booking/admin/store-photos')).toBe('/booking/bookings');
  });
  it('メニューの登録・差替え・解除と版を保存直後の台帳へ反映する', async () => {
    expect((await menuSave('p')).status).toBe(200);
    expect(raw.prepare('SELECT media_id,ref_kind,ref_id FROM media_usages').all()).toEqual([{ media_id: 'p', ref_kind: 'booking_menu', ref_id: 'm' }]);
    expect((await menuSave('p-more', 2)).status).toBe(200);
    expect(raw.prepare('SELECT media_id FROM media_usages').all()).toEqual([{ media_id: 'p-more' }]);
    expect((await menuSave(null, 3)).status).toBe(200);
    expect(raw.prepare('SELECT * FROM media_usages').all()).toEqual([]);
    expect(raw.prepare('SELECT photo_media_id,version FROM menus WHERE id=\'m\'').get()).toEqual({ photo_media_id: null, version: 4 });
  });
  it('スタッフも登録・解除でき、通常のスタッフ設定を変えない', async () => {
    expect((await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId: 'p' })).status).toBe(200);
    expect(raw.prepare('SELECT media_id,ref_kind FROM media_usages').all()).toEqual([{ media_id: 'p', ref_kind: 'booking_staff' }]);
    expect((await request('/api/booking/admin/staff/s/photo', { expectedVersion: 2, mediaId: null })).status).toBe(200);
    expect(raw.prepare('SELECT display_name,photo_media_id,photo_version FROM staff WHERE id=\'s\'').get()).toEqual({ display_name: '担当', photo_media_id: null, photo_version: 3 });
  });
  it('店の3枠を同時保存し、同じ写真は1使用先。順だけの変更と部分解除も保護を保つ', async () => {
    expect((await storeSave(photos('p', 'p', 'p-more'))).status).toBe(200);
    expect(raw.prepare('SELECT media_id FROM media_usages ORDER BY media_id').all()).toEqual([{ media_id: 'p' }, { media_id: 'p-more' }]);
    expect((await storeSave(photos('p', null, 'p-more'), 1, ['waiting', 'exterior', 'interior'])).status).toBe(200);
    const response = await app.request('/api/liff/booking/store-photos?liffId=la', {}, { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings']);
    expect(await response.json()).toEqual({ success: true, data: [
      { slot: 'waiting', url: 'https://worker.test/media/p-more/content' },
      { slot: 'exterior', url: 'https://worker.test/media/p/content' },
    ] });
    expect((await storeSave(photos(null, null, null), 2)).status).toBe(200);
    expect(raw.prepare('SELECT * FROM media_usages').all()).toEqual([]);
  });
  it.each(['other', 'shared', 'archived', 'video', 'missing'])('%sは写真にできず、全保存経路で何も書かない', async mediaId => {
    expect((await menuSave(mediaId)).status).toBe(400);
    expect((await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId })).status).toBe(400);
    expect((await storeSave(photos(mediaId))).status).toBe(400);
    expect(raw.prepare('SELECT version,photo_media_id FROM menus WHERE id=\'m\'').get()).toEqual({ version: 1, photo_media_id: null });
    expect(raw.prepare('SELECT * FROM booking_settings').all()).toEqual([]);
    expect(raw.prepare('SELECT * FROM media_usages').all()).toEqual([]);
  });
  it('別店の対象・アカウントは拒否し、LIFFもliffIdで店を固定する', async () => {
    expect((await menuSave('p', 1, 'mb')).status).toBe(404);
    expect((await request('/api/booking/admin/staff/sb/photo', { expectedVersion: 1, mediaId: 'p' })).status).toBe(404);
    expect((await request('/api/booking/admin/menus/photos', undefined, 'b')).status).toBe(403);
    await storeSave(photos());
    const env = { DB: db } as Env['Bindings'];
    expect(await (await app.request('/api/liff/booking/store-photos?liffId=lb&account_id=a', {}, env)).json()).toEqual({ success: true, data: [] });
    expect((await app.request('/api/liff/booking/store-photos?liffId=unknown', {}, env)).status).toBe(404);
  });
  it('閲覧のみ・鍵なし・担当別の鍵を守る', async () => {
    staff = { ...staff, readOnly: true };
    expect((await request('/api/booking/admin/menus/photos')).status).toBe(200);
    expect((await menuSave('p')).status).toBe(403);
    expect((await storeSave(photos())).status).toBe(403);
    expect((await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId: 'p' })).status).toBe(403);
    staff = { ...staff, role: 'staff', readOnly: false, permissionKeys: [] };
    expect((await menuSave('p')).status).toBe(403);
    staff.permissionKeys = ['/booking/menus'];
    expect((await menuSave('p')).status).toBe(200);
    expect((await storeSave(photos())).status).toBe(403);
    staff.permissionKeys = ['booking.settings'];
    expect((await storeSave(photos())).status).toBe(200);
  });
  it('同じ版の同時保存は片方だけ通り、古い版で解除しない', async () => {
    const saved = await Promise.all([menuSave('p'), menuSave('p-more')]);
    expect(saved.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await menuSave(null)).status).toBe(409);
    expect(raw.prepare('SELECT COUNT(*) AS c FROM media_usages').get()).toEqual({ c: 1 });
    const stores = await Promise.all([storeSave(photos('p')), storeSave(photos('p-more'))]);
    expect(stores.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it('台帳への書込が失敗したら写真・版も戻す', async () => {
    raw.exec(`CREATE TRIGGER photo_test_failure BEFORE INSERT ON media_usages BEGIN SELECT RAISE(ABORT,'forced_failure'); END;`);
    expect((await menuSave('p')).status).toBe(503);
    expect(raw.prepare('SELECT version,photo_media_id FROM menus WHERE id=\'m\'').get()).toEqual({ version: 1, photo_media_id: null });
    expect((await storeSave(photos())).status).toBe(503);
    expect(raw.prepare('SELECT * FROM booking_settings').all()).toEqual([]);
  });
  it('写真3種類はID完全一致で補修し、部分一致を使われていると判定しない', async () => {
    await menuSave('p-more');
    await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId: 'p' });
    await storeSave(photos('p-more', null, 'p'));
    raw.exec('DELETE FROM media_usages');
    const result = await scanSingleMediaUsage(db, '2020-01-01', { id: 'p', r2_key: 'unrelated' });
    expect(result.matched).toBe(2);
    expect(raw.prepare('SELECT ref_kind FROM media_usages WHERE media_id=\'p\' ORDER BY ref_kind').all()).toEqual([{ ref_kind: 'booking_settings' }, { ref_kind: 'booking_staff' }]);
    const impact = await getMediaDeleteImpactSnapshot(db, 'p', 'a', '2026-10-19');
    expect(impact?.impact).toMatchObject({ usageCount: 2, canDelete: false, verified: true });
    expect(impact?.impact.references.map(row => row.href)).toEqual(['/booking/menus?tab=photos', '/booking/menus?tab=photos']);
    const plan = await getMediaReplacementPlan(db, { sourceId: 'p', replacementId: 'p-more', lineAccountId: 'a', checkedAt: '2026-10-19' });
    expect(plan?.impact.references.every(row => row.replaceable === false)).toBe(true);
    for (const [sourceIndex, expected] of [[7, 1], [8, 1], [9, 2]] as const) {
      raw.prepare(`UPDATE media_usage_scan_state SET source_index=?,last_ref_id='' WHERE id=1`).run(sourceIndex);
      // 初回の定期検査より前でも状態が得られることを確かめる。
      if (!raw.prepare('SELECT id FROM media_usage_scan_state').get()) await scanMediaUsage(db, '2026-10-01');
      raw.prepare(`UPDATE media_usage_scan_state SET source_index=?,last_ref_id='' WHERE id=1`).run(sourceIndex);
      const scanned = await scanMediaUsage(db, '2026-10-02');
      expect(scanned.matched).toBe(expected);
    }
  });
  it('削除中の画像は予約メニュー・担当者・店舗に登録できない', async () => {
    raw.prepare(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at)
      VALUES('p','a','["photos/p"]','deleting','now','now')`).run();
    expect((await menuSave('p')).status).toBe(409);
    expect((await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId: 'p' })).status).toBe(409);
    expect((await storeSave(photos())).status).toBe(409);
    expect(raw.prepare("SELECT photo_media_id FROM menus WHERE id='m'").get()).toEqual({ photo_media_id: null });
    expect(raw.prepare("SELECT photo_media_id FROM staff WHERE id='s'").get()).toEqual({ photo_media_id: null });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM media_usages WHERE media_id='p'").get()).toEqual({ count: 0 });
  });
  it('画像の事前確認と予約写真の保存の間に削除が始まると保存しない', async () => {
    const base = db;
    let intercepted = false;
    db = { ...base, batch: async (statements: D1PreparedStatement[]) => {
      if (!intercepted) {
        intercepted = true;
        raw.prepare(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at)
          VALUES('p','a','["photos/p"]','checking','now','now')`).run();
      }
      return base.batch(statements);
    } } as D1Database;
    expect((await menuSave('p')).status).toBe(409);
    expect(intercepted).toBe(true);
    expect(raw.prepare("SELECT photo_media_id FROM menus WHERE id='m'").get()).toEqual({ photo_media_id: null });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM media_usages WHERE media_id='p'").get()).toEqual({ count: 0 });
  });
  it('確認の直後に予約写真が登録されたら実体を削除しない', async () => {
    const before = await app.request('/api/media/p/delete-impact?accountId=a', {}, { DB: db } as Env['Bindings']);
    expect(before.status).toBe(200);
    expect((await before.json() as {data:{canDelete:boolean}}).data.canDelete).toBe(true);
    let inserted = false;
    // 使用先の事前確認の直後、削除の確保が始まる前に予約写真が保存される。
    const racing = { ...db, async batch(statements: D1PreparedStatement[]) {
      if (!inserted) {
        inserted = true;
        expect((await menuSave('p')).status).toBe(200);
      }
      return db.batch(statements);
    } } as D1Database;
    const remove = vi.fn();
    const response = await app.request('/api/media/p?accountId=a', { method: 'DELETE' }, { DB: racing, IMAGES: { delete: remove } } as unknown as Env['Bindings']);
    expect(inserted).toBe(true);
    expect(response.status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
    expect(raw.prepare("SELECT photo_media_id FROM menus WHERE id='m'").get()).toEqual({ photo_media_id: 'p' });
    expect(raw.prepare("SELECT id FROM media WHERE id='p'").get()).toEqual({ id: 'p' });
  });
  it('削除のR2処理中には予約写真へ登録できない', async () => {
    let registrationStatus = 0;
    const remove = vi.fn(async () => { registrationStatus = (await menuSave('p')).status; });
    const response = await app.request('/api/media/p?accountId=a', { method: 'DELETE' }, { DB: db, IMAGES: { delete: remove } } as unknown as Env['Bindings']);
    expect(registrationStatus).toBe(409);
    expect(response.status).toBe(200);
    expect(raw.prepare("SELECT photo_media_id FROM menus WHERE id='m'").get()).toEqual({ photo_media_id: null });
  });
  it('R2削除が失敗したときキーを保持して再試行できる', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error('R2 unavailable')).mockResolvedValue(undefined);
    const env = { DB: db, IMAGES: { delete: remove } } as unknown as Env['Bindings'];
    expect((await app.request('/api/media/p?accountId=a', { method: 'DELETE' }, env)).status).toBe(503);
    const job = raw.prepare("SELECT r2_keys_json,status FROM media_deletion_jobs WHERE media_id='p'").get() as { r2_keys_json: string; status: string };
    expect(job.status).toBe('deleting');
    expect(JSON.parse(job.r2_keys_json)).toContain('photos/p');
    expect((await menuSave('p')).status).toBe(409);
    expect((await app.request('/api/media/p?accountId=a', { method: 'DELETE' }, env)).status).toBe(200);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(raw.prepare("SELECT id FROM media WHERE id='p'").get()).toBeUndefined();
    expect(raw.prepare("SELECT status FROM media_deletion_jobs WHERE media_id='p'").get()).toEqual({ status: 'completed' });
  });
  it('メディア一覧の実際の削除口で予約写真3種類を止め、保管庫を削除しない', async () => {
    await menuSave('p');
    await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId: 'p' });
    await storeSave(photos());
    const remove = vi.fn();
    const response = await app.request('/api/media/p?accountId=a', { method: 'DELETE' }, { DB: db, IMAGES: { delete: remove } } as unknown as Env['Bindings']);
    expect(response.status).toBe(409);
    const body = await response.json() as { data: { references: Array<{ kind: string }> } };
    expect(body.data.references.map(row => row.kind).sort()).toEqual(['booking_menu', 'booking_settings', 'booking_staff']);
    expect(remove).not.toHaveBeenCalled();
    expect(raw.prepare("SELECT id FROM media WHERE id='p'").get()).toEqual({ id: 'p' });
  });
  it('自動応答の本文・版と来店スタンプの使用先を店ごとに確認して削除を止める', async () => {
    raw.exec(`INSERT INTO tenants(id,name) VALUES ('tenant-test','架空');
      INSERT INTO auto_replies(id,keyword,response_type,response_content,line_account_id,name) VALUES
        ('reply-a','a','image','https://worker.test/images/photos/p','a','本店の応答'),
        ('reply-version','v','text','本文なし','a','版の応答'),
        ('reply-b','b','image','https://worker.test/images/photos/p','b','別店の応答');
      INSERT INTO auto_reply_versions(id,auto_reply_id,version_number,line_account_id,definition_snapshot,status,created_at)
        VALUES ('version-a','reply-version',1,'a','{"image":"https://worker.test/media/p/content"}','published','2026-01-01');
      INSERT INTO visit_stamp_cards(id,tenant_id,name,settings_json) VALUES
        ('stamp-a','tenant-test','本店カード','{"backgroundImageUrl":"https://worker.test/images/photos/p"}'),
        ('stamp-b','tenant-test','別店カード','{"backgroundImageUrl":"https://worker.test/images/photos/p"}');
      INSERT INTO visit_stamp_card_accounts(card_id,line_account_id) VALUES ('stamp-a','a'),('stamp-b','b');`);
    const env = { DB: db, WORKER_URL:'https://worker.test', IMAGES: { delete: vi.fn() } } as unknown as Env['Bindings'];
    const impact = await app.request('/api/media/p/delete-impact?accountId=a', {}, env);
    expect(impact.status).toBe(200);
    const body = await impact.json() as { data:{ usageCount:number; canDelete:boolean; references:Array<{kind:string;name:string}> } };
    expect(body.data.canDelete).toBe(false);
    expect(body.data.references.map(r=>[r.kind,r.name])).toEqual(expect.arrayContaining([['auto_reply','本店の応答'],['auto_reply','版の応答'],['visit_stamp_card','本店カード']]));
    expect(JSON.stringify(body)).not.toContain('別店');
    const removed = await app.request('/api/media/p?accountId=a', { method:'DELETE' }, env);
    expect(removed.status).toBe(409);
    expect(env.IMAGES.delete).not.toHaveBeenCalled();
    const replacement = await app.request('/api/media/p/replacement-impact?accountId=a&replacementId=p-more', {}, env);
    const plan = await replacement.json() as { data:{ canReplace:boolean; canPartiallyReplace:boolean; usageCount:number } };
    expect(plan.data).toMatchObject({ canReplace:false, canPartiallyReplace:false, usageCount:5 });
  });
  it.each(['本文', '過去の版'])('全店共通の自動応答の%sが画像を使えば、店の画像を消せない', async source => {
    raw.exec(`INSERT INTO auto_replies(id,keyword,response_type,response_content,line_account_id,name) VALUES
      ('global','global','image',${source === '本文' ? "'https://worker.test/images/photos/p'" : "'本文なし'"},NULL,'全店共通の応答'),
      ('other-shop','other','image','https://worker.test/images/photos/p','b','別店だけの応答');`);
    if (source === '過去の版') raw.exec(`INSERT INTO auto_reply_versions(id,auto_reply_id,version_number,line_account_id,definition_snapshot,status,created_at)
      VALUES ('global-version','global',1,NULL,'{"image":"https://worker.test/media/p/content"}','published','2026-01-01');`);
    const remove = vi.fn();
    const env = { DB: db, WORKER_URL:'https://worker.test', IMAGES:{delete:remove} } as unknown as Env['Bindings'];
    const impact = await app.request('/api/media/p/delete-impact?accountId=a', {}, env);
    expect(impact.status).toBe(200);
    const body = await impact.json() as {data:{usageCount:number;canDelete:boolean;references:Array<{name:string}>}};
    expect(body.data).toMatchObject({ usageCount:2, canDelete:false });
    expect(body.data.references.map(reference => reference.name)).toContain('全店共通の応答');
    expect(JSON.stringify(body)).not.toContain('別店だけの応答');
    expect((await app.request('/api/media/p?accountId=a', {method:'DELETE'}, env)).status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
  });
  it('別店だけの参照も匿名で削除を止める', async () => {
    raw.exec(`INSERT INTO auto_replies(id,keyword,response_type,response_content,line_account_id,name)
      VALUES ('reply-b','b','image','https://worker.test/images/photos/p','b','別店だけ');`);
    const response = await app.request('/api/media/p/delete-impact?accountId=a', {}, { DB: db } as Env['Bindings']);
    const body = await response.json() as {data:{usageCount:number;canDelete:boolean}};
    expect(body.data).toMatchObject({ usageCount:1, canDelete:false });
    expect(JSON.stringify(body)).not.toContain('別店だけ');
  });
  it('追加の使用先を読み取れない時は表示も削除も安全側で止める', async () => {
    const failingDb = { ...db, prepare(sql: string) { if (sql.includes('FROM auto_replies ar')) throw new Error('offline'); return db.prepare(sql); } } as D1Database;
    const remove = vi.fn();
    const env = { DB:failingDb, IMAGES:{delete:remove} } as unknown as Env['Bindings'];
    expect((await app.request('/api/media/p/delete-impact?accountId=a', {}, env)).status).toBe(503);
    expect((await app.request('/api/media/p?accountId=a', {method:'DELETE'}, env)).status).toBe(503);
    expect(remove).not.toHaveBeenCalled();
  });
  it('LIFFの公開メニュー・担当に写真URLが出て、取り外すと消える', async () => {
    await menuSave('p');
    await request('/api/booking/admin/staff/s/photo', { expectedVersion: 1, mediaId: 'p-more' });
    const env = { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'];
    const menus = await (await app.request('/api/liff/booking/menus?liffId=la', {}, env)).json() as { menus: Array<{ photo_url: string }> };
    expect(menus.menus[0]?.photo_url).toBe('https://worker.test/media/p/content');
    const rows = await (await app.request('/api/liff/booking/menus/m/staff?liffId=la', {}, env)).json() as { staff: Array<{ photo_url: string }> };
    expect(rows.staff[0]?.photo_url).toBe('https://worker.test/media/p-more/content');
  });
  it.each([[], ['exterior', 'exterior', 'waiting'], ['exterior', 'interior', 'waiting', 'extra'], [null, 'interior', 'waiting']].map(input => ({ input })))('店の写真の数・順の形を増やせない: $input', async ({ input }) => {
    expect((await storeSave(photos(), 0, input)).status).toBe(400);
  });
  it('公開を選ぶまでは既存の写真も公開しない。選択だけ保存し、管理と公開の読み直しを分ける', async () => {
    const env = { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'];
    const publicPhotos = async () => (await app.request('/api/liff/booking/store-photos?liffId=la', {}, env)).json();
    expect((await request('/api/booking/admin/store-photos', { photos: photos('p', 'p-more', 'p'), order, expectedVersion: 0 })).status).toBe(200);
    expect(await publicPhotos()).toEqual({ success: true, data: [] });
    expect((await storeSave(photos('p', 'p-more', 'p'), 1, ['waiting', 'interior', 'exterior'], { exterior: false, interior: true, waiting: true })).status).toBe(200);
    expect(await publicPhotos()).toEqual({ success: true, data: [
      { slot: 'waiting', url: 'https://worker.test/media/p/content' },
      { slot: 'interior', url: 'https://worker.test/media/p-more/content' },
    ] });
    const admin = await (await request('/api/booking/admin/menus/photos')).json() as { data: { store: { version: number; photos: unknown; visibility: unknown } } };
    expect(admin.data.store).toMatchObject({ version: 2, photos: { exterior: { mediaId: 'p' } }, visibility: { exterior: false, interior: true, waiting: true } });
    // 古い版の保存で非公開の枠を黙って再公開しないことを確かめる。
    expect((await request('/api/booking/admin/store-photos', { photos: photos('p', 'p-more', 'p'), order, expectedVersion: 2 })).status).toBe(200);
    expect((await publicPhotos() as { data: Array<{ slot: string }> }).data.map(p => p.slot)).toEqual(['interior', 'waiting']);
    expect((await storeSave(photos('p', 'p-more', 'p'), 3, order, { exterior: false, interior: false, waiting: false })).status).toBe(200);
    expect(await publicPhotos()).toEqual({ success: true, data: [] });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM media_usages').get()).toEqual({ count: 2 });
  });
  it('公開の保存失敗は写真・順・版・使用台帳も戻し、片側だけ保存しない', async () => {
    await storeSave(photos(), 0, order, { exterior: true, interior: false, waiting: false });
    raw.exec("CREATE TRIGGER visibility_test_failure BEFORE UPDATE ON account_settings BEGIN SELECT RAISE(ABORT,'forced_failure'); END;");
    expect((await storeSave(photos('p-more'), 1, ['waiting', 'interior', 'exterior'], { exterior: false, interior: true, waiting: false })).status).toBe(503);
    expect(raw.prepare('SELECT version,store_photo_media_id,store_photo_order_json FROM booking_settings').get()).toEqual({ version: 1, store_photo_media_id: 'p', store_photo_order_json: JSON.stringify(order) });
    expect(raw.prepare('SELECT media_id FROM media_usages').all()).toEqual([{ media_id: 'p' }]);
    const admin = await (await request('/api/booking/admin/menus/photos')).json() as { data: { store: { visibility: unknown } } };
    expect(admin.data.store.visibility).toEqual({ exterior: true, interior: false, waiting: false });
  });
  it('同時保存と古い版は公開の選択も上書きしない', async () => {
    const visible = { exterior: true, interior: false, waiting: false };
    const hidden = { exterior: false, interior: false, waiting: false };
    const results = await Promise.all([storeSave(photos(), 0, order, visible), storeSave(photos('p-more'), 0, order, hidden)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const admin = await (await request('/api/booking/admin/menus/photos')).json() as { data: { store: { visibility: unknown; photos: { exterior: { mediaId: string } } } } };
    expect(admin.data.store.visibility).toEqual(results[0]!.status === 200 ? visible : hidden);
    expect(admin.data.store.photos.exterior.mediaId).toBe(results[0]!.status === 200 ? 'p' : 'p-more');
    const before = raw.prepare('SELECT value FROM account_settings').get();
    expect((await storeSave(photos('p-more'), 0, order, hidden)).status).toBe(409);
    expect(raw.prepare('SELECT value FROM account_settings').get()).toEqual(before);
    staff = { ...staff, readOnly: true };
    expect((await storeSave(photos('p-more'), 1, order, hidden)).status).toBe(403);
    expect(raw.prepare('SELECT value FROM account_settings').get()).toEqual(before);
  });
  it.each([null, [], {}, { exterior: 'true', interior: false, waiting: false }, { exterior: true, interior: false, waiting: false, extra: true }])('公開の選択の不正な形は保存しない: %j', async visibility => {
    expect((await storeSave(photos(), 0, order, visibility)).status).toBe(400);
    expect(raw.prepare('SELECT * FROM booking_settings').all()).toEqual([]);
    expect(raw.prepare('SELECT * FROM account_settings').all()).toEqual([]);
  });
  it('公開設定が壊れていたら写真を公開せず、別店の選択も参照しない', async () => {
    await storeSave(photos());
    raw.prepare("UPDATE account_settings SET value='invalid-json'").run();
    const env = { DB: db } as Env['Bindings'];
    expect(await (await app.request('/api/liff/booking/store-photos?liffId=la', {}, env)).json()).toEqual({ success: true, data: [] });
    raw.prepare("UPDATE account_settings SET line_account_id='b',value=?").run(JSON.stringify({ exterior: true, interior: true, waiting: true }));
    expect(await (await app.request('/api/liff/booking/store-photos?liffId=la', {}, env)).json()).toEqual({ success: true, data: [] });
  });

});

it('飲食メニューが使う登録画像は削除できず、影響から編集先へ進める', async () => {
  raw.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','架空組織');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','架空店','S','a');
    INSERT INTO rt_menu_items(id,store_id,kind,name,price,image_media_id) VALUES('dish','store','course','架空コース',1000,'p');`);
  const storageDelete = vi.fn();
  const bindings = { DB: db, WORKER_URL:'https://worker.test', IMAGES:{ delete:storageDelete } } as unknown as Env['Bindings'];
  const preview = await app.request('/api/media/p/delete-impact?accountId=a', {}, bindings);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ data:{ canDelete:false, usageCount:1, references:[expect.objectContaining({kind:'restaurant_menu', name:'架空コース', href:'/restaurant-test/menu/edit?id=dish'})] } });
  const deletion = await app.request('/api/media/p?accountId=a', { method:'DELETE' }, bindings);
  expect(deletion.status).toBe(409);
  expect(storageDelete).not.toHaveBeenCalled();
});

it('飲食メニューと全店共通の自動応答が同じ画像を使う場合、両方の使用先と差替え時の版を守る', async () => {
  raw.exec(`INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','架空組織');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','架空店','S','a');
    INSERT INTO rt_menu_items(id,store_id,kind,name,price,image_media_id) VALUES('dish','store','course','架空コース',1000,'p');
    INSERT INTO auto_replies(id,keyword,response_type,response_content,line_account_id,name)
      VALUES('global','global','image','https://worker.test/images/photos/p',NULL,'全店共通の応答');`);
  const remove = vi.fn();
  const env = { DB: db, WORKER_URL:'https://worker.test', IMAGES:{delete:remove} } as unknown as Env['Bindings'];
  const deletionImpact = await app.request('/api/media/p/delete-impact?accountId=a', {}, env);
  expect(deletionImpact.status).toBe(200);
  const deleted = await deletionImpact.json() as {data:{canDelete:boolean;usageCount:number;references:Array<{kind:string;name:string}>}};
  expect(deleted.data).toMatchObject({canDelete:false,usageCount:2});
  expect(deleted.data.references).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:'restaurant_menu',name:'架空コース'}),
    expect.objectContaining({kind:'auto_reply',name:'全店共通の応答'}),
  ]));
  expect((await app.request('/api/media/p?accountId=a', {method:'DELETE'}, env)).status).toBe(409);
  expect(remove).not.toHaveBeenCalled();
  const getImpact = async () => {
    const response = await app.request('/api/media/p/replacement-impact?accountId=a&replacementId=p-more', {}, env);
    expect(response.status).toBe(200);
    return (await response.json() as {data:{revision:string;usageCount:number;canReplace:boolean;references:Array<{kind:string}>}}).data;
  };
  const both = await getImpact();
  expect(both).toMatchObject({usageCount:2,canReplace:false});
  expect(both.references.map(ref => ref.kind)).toEqual(expect.arrayContaining(['restaurant_menu','auto_reply']));
  raw.prepare('UPDATE rt_menu_items SET image_media_id = NULL WHERE id = ?').run('dish');
  const replyOnly = await getImpact();
  expect(replyOnly).toMatchObject({usageCount:1,canReplace:false});
  expect(replyOnly.revision).not.toBe(both.revision);
  raw.prepare('UPDATE rt_menu_items SET image_media_id = ? WHERE id = ?').run('p','dish');
  raw.prepare('DELETE FROM auto_replies WHERE id = ?').run('global');
  const menuOnly = await getImpact();
  expect(menuOnly).toMatchObject({usageCount:1,canReplace:false});
  expect(menuOnly.revision).not.toBe(both.revision);
});

it('飲食メニューの使用先を読み取れない場合、差替え影響を未使用として返さない', async () => {
  const brokenDb = { ...db, prepare(sql: string) {
    if (sql.includes('SELECT id FROM rt_menu_items WHERE image_media_id')) {
      return { bind: () => ({ all: async () => { throw new Error('simulated menu query failure'); } }) } as unknown as D1PreparedStatement;
    }
    return db.prepare(sql);
  } } as D1Database;
  const env = { DB: brokenDb, WORKER_URL:'https://worker.test' } as Env['Bindings'];
  const response = await app.request('/api/media/p/replacement-impact?accountId=a&replacementId=p-more', {}, env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ success:false, error:'差し替えたときの影響を確認できませんでした' });
});

it('送信済みトークは件数だけを示して削除を許し、履歴を残す', async () => {
  raw.exec(`INSERT INTO friends(id,line_user_id,line_account_id) VALUES('private-friend','U-private','a');
    INSERT INTO messages_log(id,friend_id,line_account_id,direction,message_type,content,source)
    VALUES('sent-image','private-friend','a','outgoing','image','https://worker.test/images/photos/p','manual');`);
  const remove=vi.fn();
  const env={DB:db,WORKER_URL:'https://worker.test',IMAGES:{delete:remove}} as unknown as Env['Bindings'];
  const impact=await app.request('/api/media/p/delete-impact?accountId=a',{},env);
  expect(impact.status).toBe(200);
  const result=await impact.json() as {data:{canDelete:boolean;sentMessageCount:number}};
  expect(result.data).toMatchObject({canDelete:true,sentMessageCount:1});
  expect(JSON.stringify(result.data)).not.toContain('private-friend');
  expect((await app.request('/api/media/p?accountId=a',{method:'DELETE'},env)).status).toBe(200);
  expect(remove).toHaveBeenCalled();
  expect(raw.prepare("SELECT count(*) n FROM messages_log WHERE id='sent-image'").get()).toEqual({n:1});
});
