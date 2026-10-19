import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { csvRecordCount, outputAuditMiddleware } from './output-audit.js';
import { piiMaskMiddleware } from './impersonation.js';

let db: SqliteD1;
beforeEach(() => { db = createTestD1(); }); afterEach(() => db.raw.close());
function app(path: string, format: 'csv' | 'file', status = 200, impersonating = false) {
  const a = new Hono<Env>(); a.use('*', async (c, next) => {
    c.set('staff', { id: 'fixture-operator', name: 'Fixture', role: 'owner', tenantId: 'fixture-tenant', readOnly: false });
    if (impersonating) c.set('impersonation', { id: 'fixture-impersonation', tenantId: 'fixture-tenant', mode: 'read', piiRevealed: false, startedAt: new Date().toISOString() });
    return next();
  }); a.use('*', outputAuditMiddleware); a.use('*', piiMaskMiddleware);
  a.get(path, c => {
    c.set('outputAudit', { count: format === 'file' ? 1 : 2, accountId: 'fixture-account', targetId: 'fixture-id' });
    if (status !== 200) return c.json({ success: false }, status as 403);
    return c.body(format === 'file' ? 'fixture-file-content' : 'Name,Note\r\n"Fixture","a\nb"\r\n"Other","safe"\r\n', 200, { 'Content-Type': format === 'file' ? 'application/pdf' : 'text/csv' });
  }); return a;
}

describe('export audit', () => {
  it('counts quoted CSV newlines as a single record; excludes notes and headers', () => {
    expect(csvRecordCount('\uFEFF# a note\r\n"h","v"\r\n"a","line\nline"\r\n"b","escaped ""q"""\r\n')).toBe(2);
  });
  it.each([['/api/booking/admin/bookings.csv', 'csv'], ['/api/form-files/document/content', 'file'], ['/api/friends/exports/id/download', 'csv']] as const)('%s records actor/store/count/result and prevents caching', async (path, format) => {
    const res = await app(path, format).request(path, {}, { DB: db.db } as Env['Bindings']);
    expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const event = db.raw.prepare('SELECT actor_principal_id,line_account_id,result,after_json FROM audit_events').get() as Record<string, string>;
    expect(event).toMatchObject({ actor_principal_id: 'fixture-operator', line_account_id: 'fixture-account', result: 'success' });
    expect(JSON.parse(event.after_json).count).toBe(format === 'file' ? 1 : 2);
    expect(event.after_json).not.toContain('line\\nline');
  });
  it.each([403, 404, 500])('records denied or failed responses (%i) as zero released records', async status => {
    const path = '/api/booking/admin/bookings.csv';
    await app(path, 'csv', status).request(path, {}, { DB: db.db } as Env['Bindings']);
    const event = db.raw.prepare('SELECT result,after_json FROM audit_events').get() as { result: string; after_json: string };
    expect(event.result).toBe(status < 500 ? 'denied' : 'failed'); expect(JSON.parse(event.after_json).count).toBe(0);
  });
  it('PII denial before a route still has an export audit record', async () => {
    const path = '/api/booking/admin/bookings.csv';
    expect((await app(path, 'csv', 200, true).request(path, {}, { DB: db.db } as Env['Bindings'])).status).toBe(403);
    expect(db.raw.prepare("SELECT result FROM audit_events WHERE action='data.export'").get()).toEqual({ result: 'denied' });
  });
  it('failure to persist the audit never returns a sensitive file', async () => {
    db.raw.prepare('DROP TABLE audit_events').run(); const path = '/api/form-files/document/content';
    const res = await app(path, 'file').request(path, {}, { DB: db.db } as Env['Bindings']);
    expect(res.status).toBe(500); expect(await res.text()).not.toContain('fixture-file-content');
  });
});

it('stamps actor/time metadata while preserving CSV bytes for reimport',async()=>{
  const res=await app('/api/booking/admin/bookings.csv','csv').request('/api/booking/admin/bookings.csv',{}, {DB:db.db} as Env['Bindings']);
  const csv=await res.text();expect(csv).toBe('Name,Note\r\n"Fixture","a\nb"\r\n"Other","safe"\r\n');
  expect(csvRecordCount(csv)).toBe(2);expect(csv).not.toContain('# exported_by=Fixture');
  expect(res.headers.get('X-Exported-By')).toBe('fixture-operator');expect(res.headers.get('X-Exported-At')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it('stamps both ASCII and UTF-8 binary filenames while preserving original bytes',async()=>{
 const a=new Hono<Env>();a.use('*',async(c,next)=>{c.set('staff',{id:'fixture-actor',name:'Private Name',role:'owner',readOnly:false});await next();});
 a.use('*',outputAuditMiddleware);a.get('/api/media/item/download',c=>c.body(new Uint8Array([1,2,3]),200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download.pdf"; filename*=UTF-8''${encodeURIComponent('添付.pdf')}`}));
 const res=await a.request('/api/media/item/download',{}, {DB:db.db} as Env['Bindings']);expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1,2,3]);
 expect(res.headers.get('Content-Disposition')).toContain('download-by-fixture-actor-');expect(decodeURIComponent(res.headers.get('Content-Disposition')!)).toContain('添付-by-fixture-actor-');expect(res.headers.get('Content-Disposition')).not.toContain('Private Name');
});
