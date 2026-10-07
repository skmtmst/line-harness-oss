import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { companySettings } from './company-settings.js';
import { routeClassification } from '../middleware/feature-enforcement.js';

let sql: Database.Database, db: D1Database, app: Hono<Env>, staff: AuthenticatedStaff;
const input = { companyName: '試験会社', loginDisplayName: '試験ログイン', logoMediaId: null,
  logoBackgroundColor: '#aBcDeF', expectedVersion: 0 };
async function request(method = 'GET', body?: unknown, suffix = '') {
  const response = await app.request(`/api/settings/company${suffix}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: db } as Env['Bindings']);
  return { status: response.status, body: await response.json() as any };
}
function logo(id: string, account = 'a', mime = 'image/png') {
  sql.prepare(`INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,public_url)
    VALUES (?,?,'image','試験画像',?,1,?, ?)`).run(id, account, mime, `fixture/${id}`, `https://images.test/${id}`);
  sql.prepare(`INSERT INTO media_versions(id,media_id,version_no,r2_key,mime_type,size_bytes,scan_status,published_at)
    VALUES (?,?,1,?,?,1,'verified','2026-10-07')`).run(`v-${id}`, id, `fixture/${id}`, mime);
}
beforeEach(() => {
  const fixture = createTestD1({ foreignKeys: true }); sql = fixture.raw; db = fixture.db;
  sql.exec(`INSERT INTO tenants(id,name) VALUES ('tenant-a','会社A'),('tenant-b','会社B');
    INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id)
      VALUES ('a','店舗A','fixture-a','fixture','fixture','tenant-a'),('b','店舗B','fixture-b','fixture','fixture','tenant-b');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id)
      VALUES ('owner','試験管理者','owner','fixture-owner','tenant-a');`);
  staff = { id: 'owner', name: '試験管理者', role: 'owner', tenantId: 'tenant-a', readOnly: false };
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', staff); await next(); });
  app.route('/', companySettings);
});
afterEach(() => sql.close());

describe('会社設定のHTTPと実SQLite', () => {
  test('初期値・保存・会社名の連動・版・監査を返す', async () => {
    expect((await request()).body.data).toEqual({ companyName: '会社A', loginDisplayName: '会社A',
      logoMediaId: null, logoUrl: null, logoBackgroundColor: '#ffffff', version: 0 });
    const saved = await request('PUT', input);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ companyName: input.companyName, loginDisplayName: input.loginDisplayName,
      logoMediaId: null, logoUrl: null, logoBackgroundColor: '#abcdef', version: 1 });
    expect(await request()).toEqual(saved);
    expect(sql.prepare("SELECT name FROM tenants WHERE id='tenant-a'").get()).toEqual({ name: input.companyName });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='company_settings.updated'").get()).toEqual({ n: 1 });
    expect(routeClassification('/api/settings/company', 'PUT')?.kind).toBe('core');
  });
  test('古い版の保存は409で、保存済みの値と監査を変えない', async () => {
    const saved = await request('PUT', input);
    expect((await request('PUT', { ...input, companyName: '古い編集' })).status).toBe(409);
    expect(await request()).toEqual(saved);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM audit_events').get()).toEqual({ n: 1 });
  });
  test('同じ版の同時保存は1件だけ成功する', async () => {
    const original = db.batch.bind(db); let tail: Promise<unknown> = Promise.resolve();
    db.batch = ((statements: D1PreparedStatement[]) => {
      const next = tail.then(() => original(statements)); tail = next.catch(() => {}); return next;
    }) as D1Database['batch'];
    const replies = await Promise.all([request('PUT', input), request('PUT', { ...input, companyName: 'もう一つの編集' })]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await request()).body.data.version).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM audit_events').get()).toEqual({ n: 1 });
  });
  test('監査の失敗は会社名と版も戻す', async () => {
    sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'試験用の失敗'); END");
    expect((await request('PUT', input)).status).toBe(500);
    expect((await request()).body.data).toMatchObject({ companyName: '会社A', version: 0 });
  });
  test('管理者も保存でき、スタッフ・読み取り専用・アカウント限定は保存できない', async () => {
    staff.role = 'admin'; sql.exec("UPDATE staff_members SET role='admin' WHERE id='owner'");
    expect((await request('PUT', input)).status).toBe(200);
    staff.role = 'staff'; sql.exec("UPDATE staff_members SET role='staff' WHERE id='owner'");
    expect((await request('PUT', input)).status).toBe(403);
    staff.role = 'owner'; sql.exec("UPDATE staff_members SET role='owner' WHERE id='owner'");
    staff.readOnly = true; expect((await request('PUT', input)).status).toBe(403);
    staff.readOnly = false; sql.exec("UPDATE staff_members SET access_level='read_only' WHERE id='owner'");
    expect((await request('PUT', input)).status).toBe(403);
    sql.exec("UPDATE staff_members SET access_level='full',account_scope='accounts' WHERE id='owner'");
    expect((await request('PUT', input)).status).toBe(403);
    expect((await request()).status).toBe(200);
  });
  test('所属は認証から決まり、本文やクエリで別会社を選べない', async () => {
    expect((await request('PUT', { ...input, tenantId: 'tenant-b' }, '?tenantId=tenant-b')).status).toBe(200);
    expect(sql.prepare("SELECT name,company_settings_version AS version FROM tenants WHERE id='tenant-b'").get())
      .toEqual({ name: '会社B', version: 0 });
    staff.tenantId = 'tenant-b'; expect((await request()).status).toBe(403);
    staff.tenantId = undefined; expect((await request()).status).toBe(403);
    staff.tenantId = 'tenant-a'; sql.exec("UPDATE staff_members SET is_active=0 WHERE id='owner'");
    expect((await request('PUT', input)).status).toBe(403);
  });
  test('会社内の画像を選択・解除でき、移籍後のURLは他社へ出さない', async () => {
    logo('logo');
    expect((await request('PUT', { ...input, logoMediaId: 'logo' })).body.data)
      .toMatchObject({ logoMediaId: 'logo', logoUrl: 'https://images.test/logo' });
    sql.exec("UPDATE line_accounts SET tenant_id='tenant-b' WHERE id='a'");
    expect((await request()).body.data.logoUrl).toBeNull();
    expect((await request('PUT', { ...input, expectedVersion: 1 })).body.data).toMatchObject({ logoMediaId: null, logoUrl: null, version: 2 });
  });
  test('他社・不存在・退避済み・未検証・未公開・SVGをロゴにできない', async () => {
    logo('foreign', 'b'); logo('archived'); logo('pending'); logo('unpublished'); logo('svg', 'a', 'image/svg+xml');
    sql.exec("UPDATE media SET archived_at='2026-10-07' WHERE id='archived'; UPDATE media_versions SET scan_status='pending' WHERE media_id='pending'; UPDATE media_versions SET published_at=NULL WHERE media_id='unpublished'");
    for (const logoMediaId of ['foreign', 'missing', 'archived', 'pending', 'unpublished', 'svg']) {
      expect((await request('PUT', { ...input, logoMediaId })).status).toBe(422);
    }
    expect((await request()).body.data.version).toBe(0);
  });
  test('保存直前に画像の所属が変わっても保存しない', async () => {
    logo('logo'); const original = db.batch.bind(db);
    db.batch = (async statements => { sql.exec("UPDATE line_accounts SET tenant_id='tenant-b' WHERE id='a'"); return original(statements); }) as D1Database['batch'];
    expect((await request('PUT', { ...input, logoMediaId: 'logo' })).status).toBe(409);
    expect((await request()).body.data).toMatchObject({ logoMediaId: null, version: 0 });
  });
  test.each([{ companyName: '' }, { loginDisplayName: ' ' }, { logoMediaId: 'https://other.test/x' },
    { logoBackgroundColor: 'red' }, { expectedVersion: -1 }, { expectedVersion: 0.5 }, { expectedVersion: undefined }])
    ('不正な入力を保存前に拒否する %j', async invalid => {
      expect((await request('PUT', { ...input, ...invalid })).status).toBe(400);
      expect((await request()).body.data.version).toBe(0);
    });
});
