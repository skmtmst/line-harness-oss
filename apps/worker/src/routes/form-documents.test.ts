import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLayout, validateAnswer, type FormInputBlock } from '@line-crm/shared';
import { insertFormSubmissionRecord } from '@line-crm/db';
import { formDocuments, uploadFormDocument } from './form-documents.js';
import { documentAnswer, hydrateDocumentAnswers, validateDocumentAnswers, purgeExpiredFormDocuments } from '../services/form-documents.js';
import { processDueFileScans } from './file-scan.js';
import type { Env } from '../index.js';
vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope: vi.fn(async () => ({ ids: ['a'] })) }));
let sql: Database.Database;
let db: D1Database;
let role = 'owner';
let objects: Map<string, Uint8Array>;
let store: R2Bucket;
const block: FormInputBlock = { id: 'block', kind: 'input', type: 'file', name: 'doc', label: '本人確認', fileKind: 'identity', fileBothSides: true, required: true };
const layout = () => { const v = emptyLayout(); v.sections[0].blocks = [block]; return v; };
function adapter(sql: Database.Database): D1Database {
  const prepare = (query: string) => {
    const bindable = (args: unknown[]): any => ({ bind: (...values: unknown[]) => bindable(values), first: async () => sql.prepare(query).get(...args) ?? null,
      all: async () => ({ results: sql.prepare(query).all(...args), success: true }), run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }),
      execute: () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }) });
    return bindable([]);
  };
  return { prepare, batch: async (stmts: any[]) => sql.transaction(() => stmts.map(s => s.execute()))() } as unknown as D1Database;
}
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,0,0,0,0,73,69,78,68,174,66,96,130]);
function app() {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => { c.set('staff', { role, id: 'staff', tenantId: 't' } as any); await next(); });
  a.route('/', formDocuments);
  a.post('/upload', c => uploadFormDocument(c, c.req.query('kind') === 'mixed' ? { ...block, fileKinds: ['image', 'pdf', 'identity'], fileBothSides: false } : c.req.query('kind') === 'pdf' ? { ...block, fileKind: 'pdf', fileBothSides: false } : block, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null }));
  return a;
}
function env() { return { DB: db, IMAGES: store } as Env['Bindings']; }
async function upload(side = 'front', bytes: Uint8Array = png, mime = 'image/png', kind = 'identity') {
  const response = await app().fetch(new Request(`https://app.test/upload?side=${side}&kind=${kind}`, { method: 'POST', headers: { 'Content-Type': mime }, body: bytes as unknown as BodyInit }), env());
  return { response, body: await response.json() as any };
}
beforeEach(() => {
  role = 'owner'; objects = new Map();
  sql = new Database(':memory:'); sql.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO tenants(id,name) VALUES ('t','T'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES ('a','A','c','tok','sec','t');
    INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES ('u','U','a','U'); INSERT INTO forms(id,name,fields) VALUES ('f','F','[]');`);
  db = adapter(sql);
  store = { put: vi.fn(async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); }), delete: vi.fn(async (key: string) => { objects.delete(key); }),
    get: vi.fn(async (key: string) => { const value = objects.get(key); return value ? { body: value, arrayBuffer: async () => value.slice().buffer } : null; }) } as unknown as R2Bucket;
});
afterEach(() => { vi.unstubAllGlobals(); sql.close(); });
describe('private form documents', () => {
  it('stores front/back privately, binds both to one answer, redacts staff, and serves owner/admin only', async () => {
    const front = await upload(); const back = await upload('back');
    expect(front.response.status).toBe(201); expect(back.response.status).toBe(201);
    const values = [front.body.data.file, back.body.data.file];
    const data = { doc: values };
    expect(await validateDocumentAnswers(db, layout(), data, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null })).toBeNull();
    const record = await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: JSON.stringify(data), fileIds: values.map(v => v.fileId) });
    const redacted = await hydrateDocumentAnswers(db, data, 'staff', record.id);
    expect((redacted.doc as any[])[0]).toEqual({ fileId: values[0].fileId, kind: 'identity', side: 'front', state: 'restricted' });
    role = 'staff'; expect((await app().request(`/api/form-files/${values[0].fileId}/content`, {}, env())).status).toBe(403);
    for (const allowed of ['owner','admin']) { role = allowed; const response = await app().request(`/api/form-files/${values[0].fileId}/content`, {}, env()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); }
    expect([...objects.keys()][0]).toMatch(/^private\/form-documents\//);
    expect(await validateDocumentAnswers(db, layout(), data, { accountId: 'other', formId: 'f', friendId: 'u', versionId: null })).not.toBeNull();
  });
  it('requires both sides and refuses foreign friend/version and reusing a submitted upload', async () => {
    const front = (await upload()).body.data.file;
    expect(validateAnswer(block, [front])).toContain('表と裏');
    expect(await validateDocumentAnswers(db, layout(), { doc: [front] }, { accountId: 'a', formId: 'f', friendId: 'other', versionId: null })).not.toBeNull();
    expect(await validateDocumentAnswers(db, layout(), { doc: [front] }, { accountId: 'a', formId: 'f', friendId: 'u', versionId: 'other' })).not.toBeNull();
    await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: [front.fileId] });
    await expect(insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: [front.fileId] })).rejects.toThrow('document_attachment_conflict');
    expect(sql.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()).toEqual({ n: 1 });
  });
  it('rejects wrong formats, forged files, invalid sides and over 10MB including undeclared streams', async () => {
    expect((await upload('front', new TextEncoder().encode('not an image'))).response.status).toBe(422);
    expect((await upload('front', png, 'application/zip')).response.status).toBe(400);
    expect((await upload('single')).response.status).toBe(400);
    expect((await upload('front', new Uint8Array(10485761))).response.status).toBe(400);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('accepts PDF, blocks active PDF, and enforces the same 10MB ceiling', async () => {
    expect((await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf')).response.status).toBe(201);
    expect((await upload('single', new TextEncoder().encode('%PDF-1.7\n/JavaScript'), 'application/pdf', 'pdf')).response.status).toBe(422);
    expect((await upload('single', new Uint8Array(10485761), 'application/pdf', 'pdf')).response.status).toBe(400);
  });
  it('keeps an unavailable external scan pending and retries it with the complete file', async () => {
    sql.exec(`INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_timeout_ms,updated_at) VALUES ('a','scanner','https://scan.test',1000,'2026-01-01')`);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const fullPdf = new TextEncoder().encode('%PDF-1.7\n' + ' '.repeat(300000) + '\n%%EOF');
    const result = await upload('single', fullPdf, 'application/pdf', 'pdf'); expect(result.body.data.scanStatus).toBe('pending');
    expect((await app().request(`/api/form-files/${result.body.data.file.fileId}/content`, {}, env())).status).toBe(409);
    const pendingLayout = layout(); pendingLayout.sections[0].blocks = [{ ...block, fileKind: 'pdf', fileBothSides: false }];
    expect(await validateDocumentAnswers(db, pendingLayout, { doc: [result.body.data.file] }, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null })).toContain('検査');
    sql.exec(`UPDATE media_file_scans SET next_retry_at = '2000-01-01'`);
    const fetchMock = vi.fn(async (_url, init) => { expect(init.body.byteLength).toBe(fullPdf.length); return new Response(JSON.stringify({ verdict: 'clean' })); }); vi.stubGlobal('fetch', fetchMock);
    await processDueFileScans(env()); expect(fetchMock).toHaveBeenCalled();
    expect((await app().request(`/api/form-files/${result.body.data.file.fileId}/content`, {}, env())).status).toBe(200);
  });
  it('protects PDF as identity when multiple kinds include identity and defaults to 90 days', async () => {
    const result = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'mixed');
    expect(result.response.status).toBe(201);
    const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(result.body.data.file.fileId) as any;
    expect(row.file_kind).toBe('identity');
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBeCloseTo(90 * 86400000, -2);
    role = 'staff';
    expect((await app().request(`/api/form-files/${row.id}/content`, {}, env())).status).toBe(403);
    expect((await app().request('/api/forms/document-settings/a', {}, env())).status).toBe(403);
    expect((await app().request('/api/forms/document-settings/a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityRetentionDays: 1 }) }, env())).status).toBe(403);
  });
  it('allows ordinary PDF to staff without identity expiry, rejects invalid retention and too many or duplicate attachments', async () => {
    const result = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf');
    const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(result.body.data.file.fileId) as any;
    expect(row.expires_at).toBeNull();
    role = 'staff'; expect((await app().request(`/api/form-files/${row.id}/content`, {}, env())).status).toBe(200);
    role = 'owner';
    for (const days of [0, 3651, 2.5]) expect((await app().request('/api/forms/document-settings/a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityRetentionDays: days }) }, env())).status).toBe(400);
    const pdfLayout = layout(); pdfLayout.sections[0].blocks = [{ ...block, fileKind: 'pdf', fileBothSides: false, fileMaxCount: 1 }];
    expect(await validateDocumentAnswers(db, pdfLayout, { doc: [{ fileId: row.id }, { fileId: row.id }] }, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null })).toContain('枚数');
  });
  it('uses configurable retention, denies expired content before cron, removes R2, retains the tombstone, retries deletion failures', async () => {
    await app().request('/api/forms/document-settings/a', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityRetentionDays: 2 }) }, env());
    const result = await upload(); const id = result.body.data.file.fileId;
    const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(id) as any;
    expect(Date.parse(row.expires_at) - Date.now()).toBeGreaterThan(86400000);
    sql.prepare("UPDATE form_submission_files SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(id);
    expect((await app().request(`/api/form-files/${id}/content`, {}, env())).status).toBe(410);
    vi.mocked(store.delete).mockRejectedValueOnce(new Error('R2 offline'));
    expect(await purgeExpiredFormDocuments(db, store)).toBe(0);
    expect(objects.size).toBe(1); expect(await purgeExpiredFormDocuments(db, store)).toBe(1); expect(objects.size).toBe(0);
    expect(documentAnswer(sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(id) as any, 'owner').state).toBe('expired');
  });
});
