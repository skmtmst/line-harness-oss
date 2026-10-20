import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLayout, validateAnswer, type FormInputBlock } from '@line-crm/shared';

import { insertFormSubmissionRecord } from '@line-crm/db';
import { formDocuments, uploadFormDocument } from './form-documents.js';
import { documentAnswer, hydrateDocumentAnswers, validateDocumentAnswers, purgeExpiredFormDocuments, identityRetentionDays } from '../features/forms/form-documents.js';
import { fileScan, processDueFileScans } from './file-scan.js';
import type { Env } from '../worker-env.js';

vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope: vi.fn(async () => ({ ids: ['a'] })), canAccessAllLineAccounts: vi.fn(async () => true) }));
let sql: Database.Database;
let db: D1Database;
let role = 'owner';
let objects: Map<string, Uint8Array>;
let store: R2Bucket;
const block: FormInputBlock = { id: 'block', kind: 'input', type: 'file', name: 'doc', label: '本人確認', fileKind: 'identity', fileBothSides: true, required: true };
const layout = () => { const v = emptyLayout(); v.sections[0].blocks = [block]; return v; };
function adapter(sql: Database.Database): D1Database {
  const prepare = (query: string) => {
    const bindable = (args: unknown[]): any => ({ bind: (...values: unknown[]) => {
      if (values.length > 100) throw new Error('D1 bind limit exceeded');
      return bindable(values);
    }, first: async () => sql.prepare(query).get(...args) ?? null,
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
  a.route('/', formDocuments); a.route('/', fileScan);
  a.post('/upload', c => uploadFormDocument(c, c.req.query('kind') === 'image' ? { ...block, fileKind: 'image', fileBothSides: false } : c.req.query('kind') === 'image-pdf' ? { ...block, fileKinds: ['image', 'pdf'], fileBothSides: false } : c.req.query('kind') === 'mixed' ? { ...block, fileKinds: ['image', 'pdf', 'identity'], fileBothSides: false } : c.req.query('kind') === 'pdf' ? { ...block, fileKind: 'pdf', fileBothSides: false } : block, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null }));
  return a;
}
let secretReads: string[] = [];
function env() {
  return new Proxy({ DB: db, IMAGES: store, FILE_SCAN_ALLOWED_PAIRS: 'scan.example.com=FILE_SCAN_SECRET_PRIMARY', FILE_SCAN_SECRET_PRIMARY: 'test-only-token' } as unknown as Env['Bindings'], {
    get(target, name: string) {
      if (name === 'ADMIN_API_KEY' || name.startsWith('FILE_SCAN_SECRET_')) secretReads.push(name);
      return Reflect.get(target, name);
    },
  });
}
async function upload(side = 'single', bytes: Uint8Array = png, mime = 'image/png', kind = 'image') {
  const response = await app().fetch(new Request(`https://app.test/upload?side=${side}&kind=${kind}`, { method: 'POST', headers: { 'Content-Type': mime }, body: bytes as unknown as BodyInit }), env());
  return { response, body: await response.json() as any };
}
// Seed a historical identity row through a normal scanned image, then restore its stored legacy classification.
// This is fixture setup, never an upload API compatibility bypass.
async function legacyDocument(side = 'front') {
  const result = await upload();
  const id = result.body.data.file.fileId;
  const now = new Date();
  sql.prepare('UPDATE form_submission_files SET file_kind=?, side=?, expires_at=? WHERE id=?')
    .run('identity', side, new Date(now.getTime() + await identityRetentionDays(db, 'a') * 86400000).toISOString(), id);
  const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(id) as any;
  result.body.data.file = documentAnswer(row, 'owner');
  return result;
}
beforeEach(() => {
  secretReads = [];
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
  it('claims 201 artificial attachments atomically within the D1 binding limit', async () => {
    sql.exec(`INSERT INTO media_file_scans(id,line_account_id,subject_kind,subject_id,filename,mime_type,size_bytes,status)
      VALUES ('synthetic-scan','a','form_file','synthetic','synthetic.png','image/png',1,'clean')`);
    const insert = sql.prepare(`INSERT INTO form_submission_files
      (id,line_account_id,form_id,block_id,friend_id,file_kind,side,r2_key,filename,mime_type,size_bytes,scan_id,created_at)
      VALUES (?,'a','f','block','u','image','single',?,'synthetic.png','image/png',1,'synthetic-scan','2026-10-11')`);
    const ids = Array.from({ length: 201 }, (_, i) => `synthetic-${i}`);
    for (const id of ids) insert.run(id, id);
    const record = await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: ids });
    expect(sql.prepare('SELECT COUNT(*) AS n FROM form_submission_files WHERE submission_id = ?').get(record.id)).toEqual({ n: 201 });
    await expect(insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: ids })).rejects.toThrow('document_attachment_conflict');
    expect(sql.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()).toEqual({ n: 1 });
  });
  it('retains historic front/back privately, rejects new attachment, redacts staff, and serves owner/admin only', async () => {
    const front = await legacyDocument(); const back = await legacyDocument('back');
    expect(front.response.status).toBe(201); expect(back.response.status).toBe(201);
    const values = [front.body.data.file, back.body.data.file];
    const data = { doc: values };
    expect(await validateDocumentAnswers(db, layout(), data, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null })).toContain('受け取れません');
    const record = await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: JSON.stringify(data), fileIds: values.map(v => v.fileId) });
    const redacted = await hydrateDocumentAnswers(db, data, 'staff', record.id);
    expect((redacted.doc as any[])[0]).toEqual({ fileId: values[0].fileId, kind: 'identity', side: 'front', state: 'restricted' });
    role = 'staff'; expect((await app().request(`/api/form-files/${values[0].fileId}/content`, {}, env())).status).toBe(403);
    for (const allowed of ['owner','admin']) { role = allowed; const response = await app().request(`/api/form-files/${values[0].fileId}/content`, {}, env()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); }
    expect([...objects.keys()][0]).toMatch(/^private\/form-documents\//);
    expect(await validateDocumentAnswers(db, layout(), data, { accountId: 'other', formId: 'f', friendId: 'u', versionId: null })).not.toBeNull();
  });
  it('requires both sides and refuses foreign friend/version and reusing a submitted upload', async () => {
    const front = (await legacyDocument()).body.data.file;
    expect(validateAnswer(block, [front])).toContain('表と裏');
    expect(await validateDocumentAnswers(db, layout(), { doc: [front] }, { accountId: 'a', formId: 'f', friendId: 'other', versionId: null })).not.toBeNull();
    expect(await validateDocumentAnswers(db, layout(), { doc: [front] }, { accountId: 'a', formId: 'f', friendId: 'u', versionId: 'other' })).not.toBeNull();
    await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: [front.fileId] });
    await expect(insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: [front.fileId] })).rejects.toThrow('document_attachment_conflict');
    expect(sql.prepare('SELECT COUNT(*) AS n FROM form_submissions').get()).toEqual({ n: 1 });
  });
  it('rejects wrong formats, forged files, invalid sides and over 10MB including undeclared streams', async () => {
    expect((await upload('single', new TextEncoder().encode('not an image'))).response.status).toBe(422);
    expect((await upload('front', png, 'application/zip')).response.status).toBe(400);
    expect((await upload('front')).response.status).toBe(400);
    expect((await upload('front', new Uint8Array(10485761))).response.status).toBe(400);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('accepts PDF, blocks active PDF, and enforces the same 10MB ceiling', async () => {
    expect((await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf')).response.status).toBe(201);
    expect((await upload('single', new TextEncoder().encode('%PDF-1.7\n/JavaScript'), 'application/pdf', 'pdf')).response.status).toBe(422);
    expect((await upload('single', new Uint8Array(10485761), 'application/pdf', 'pdf')).response.status).toBe(400);
  });
  it('keeps an unavailable external scan pending and retries it with the complete file', async () => {
    sql.exec(`INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_secret_ref,external_timeout_ms,updated_at) VALUES ('a','scanner','https://scan.example.com','FILE_SCAN_SECRET_PRIMARY',1000,'2026-01-01')`);
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
  it('rejects mixed legacy identity settings and retains historical protection with 90-day default', async () => {
    const result = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'mixed');
    expect(result.response.status).toBe(400);
    expect(store.put).not.toHaveBeenCalled();
    const historic = await legacyDocument();
    const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(historic.body.data.file.fileId) as any;
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
    const result = await legacyDocument(); const id = result.body.data.file.fileId;
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

describe('document corrections', () => {
  it('records PDF in an image/PDF field and validates its actual kind', async () => {
    const result = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'image-pdf');
    expect(result.response.status).toBe(201);
    const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(result.body.data.file.fileId) as any;
    expect(row.file_kind).toBe('pdf'); expect(row.mime_type).toBe('application/pdf'); expect(row.expires_at).toBeNull();
    const mixedLayout = layout(); mixedLayout.sections[0].blocks = [{ ...block, fileKinds: ['image', 'pdf'], fileBothSides: false }];
    expect(await validateDocumentAnswers(db, mixedLayout, { doc: [result.body.data.file] }, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null })).toBeNull();
    mixedLayout.sections[0].blocks = [{ ...block, fileKind: 'image', fileBothSides: false }];
    expect(await validateDocumentAnswers(db, mixedLayout, { doc: [result.body.data.file] }, { accountId: 'a', formId: 'f', friendId: 'u', versionId: null })).not.toBeNull();
  });
  function external() {
    sql.exec(`INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_secret_ref,external_timeout_ms,updated_at) VALUES ('a','scanner','https://scan.example.com','FILE_SCAN_SECRET_PRIMARY',1000,'2026-01-01')`);
  }
  it('deletes externally flagged content immediately on upload', async () => {
    external(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ verdict: 'quarantined' }))));
    expect((await upload()).response.status).toBe(422);
    expect(objects.size).toBe(0);
    expect(sql.prepare('SELECT deleted_at, deletion_reason FROM form_submission_files').get()).toMatchObject({ deleted_at: expect.any(String), deletion_reason: 'unsafe' });
  });
  it('deletes externally flagged content immediately on retry and explains quarantine', async () => {
    external(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await upload(); const id = result.body.data.file.fileId;
    sql.exec("UPDATE media_file_scans SET next_retry_at='2000-01-01'");
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ verdict: 'quarantined' }))));
    await processDueFileScans(env()); expect(objects.size).toBe(0);
    const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(id) as any;
    expect(documentAnswer(row, 'owner', 'quarantined').state).toBe('quarantined');
    const response = await app().request(`/api/form-files/${id}/content`, {}, env());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: '危ないファイルのため開けません' });
  });
  it('rejects after five failed checks and never retries or promotes the rejected document', async () => {
    external(); const fetchMock = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetchMock);
    const result = await upload();
    for (let i = 0; i < 4; i++) { sql.exec("UPDATE media_file_scans SET next_retry_at='2000-01-01' WHERE status='pending'"); await processDueFileScans(env()); }
    expect(sql.prepare('SELECT status,attempts,next_retry_at FROM media_file_scans').get()).toEqual({ status: 'rejected', attempts: 5, next_retry_at: null });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(await processDueFileScans(env())).toEqual({ processed: 0, stillPending: 0 });
    expect((await app().request(`/api/form-files/${result.body.data.file.fileId}/content`, {}, env())).status).toBe(409);
  });
  it('retries deleting unsafe content after an R2 failure without waiting a day', async () => {
    external(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ verdict: 'quarantined' }))));
    vi.mocked(store.delete).mockRejectedValueOnce(new Error('R2 offline'));
    await upload(); expect(objects.size).toBe(1);
    expect(await purgeExpiredFormDocuments(db, store)).toBe(1); expect(objects.size).toBe(0);
    expect(sql.prepare('SELECT deletion_reason FROM form_submission_files').get()).toEqual({ deletion_reason: 'unsafe' });
  });
});

it('does not release or retry a quarantined form document, and preserves a failed deletion for retry', async () => {
  const result = await upload(); const id = result.body.data.file.fileId;
  const row = sql.prepare('SELECT * FROM form_submission_files WHERE id=?').get(id) as any;
  sql.prepare("UPDATE media_file_scans SET status='quarantined' WHERE id=?").run(row.scan_id);
  const headers = { 'Content-Type': 'application/json' };
  expect((await app().request(`/api/file-scans/${row.scan_id}/release`, { method: 'POST', headers, body: JSON.stringify({ accountId: 'a', reason: '確認' }) }, env())).status).toBe(409);
  expect((await app().request(`/api/file-scans/${row.scan_id}/retry`, { method: 'POST', headers, body: JSON.stringify({ accountId: 'a' }) }, env())).status).toBe(409);
  vi.mocked(store.delete).mockRejectedValueOnce(new Error('R2 offline'));
  expect((await app().request(`/api/file-scans/${row.scan_id}?accountId=a`, { method: 'DELETE' }, env())).status).toBe(503);
  expect(objects.size).toBe(1);
  expect(sql.prepare('SELECT status FROM media_file_scans WHERE id=?').get(row.scan_id)).toEqual({ status: 'quarantined' });
  expect((await app().request(`/api/file-scans/${row.scan_id}?accountId=a`, { method: 'DELETE' }, env())).status).toBe(200);
  expect(objects.size).toBe(0);
});
it('never accepts a missing R2 document as clean even when the external scanner says clean', async () => {
  sql.exec(`INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_secret_ref,external_timeout_ms,updated_at) VALUES ('a','scanner','https://scan.example.com','FILE_SCAN_SECRET_PRIMARY',1000,'2026-01-01')`);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  await upload(); objects.clear(); sql.exec("UPDATE media_file_scans SET next_retry_at='2000-01-01'");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ verdict: 'clean' }))); vi.stubGlobal('fetch', fetchMock);
  expect(await processDueFileScans(env())).toEqual({ processed: 1, stillPending: 1 });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT status FROM media_file_scans').get()).toEqual({ status: 'pending' });
});

it('accepts exactly 10MB, rejects empty files, and rejects PDF in an image-only field', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n' + ' '.repeat(10485760 - 15) + '\n%%EOF');
  expect(bytes.length).toBe(10485760);
  expect((await upload('single', bytes, 'application/pdf', 'pdf')).response.status).toBe(201);
  expect((await upload('single', new Uint8Array(), 'application/pdf', 'pdf')).response.status).toBe(400);
  expect((await upload('front', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf')).response.status).toBe(400);
  expect(objects.size).toBe(1);
});
it('retains submitted ordinary PDF past 90 days and purges an abandoned PDF after one day', async () => {
  const first = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf');
  await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: [first.body.data.file.fileId] });
  const second = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf');
  sql.exec("UPDATE form_submission_files SET created_at='2000-01-01T00:00:00Z'");
  expect(await purgeExpiredFormDocuments(db, store)).toBe(1);
  expect(objects.size).toBe(1);
  expect(sql.prepare('SELECT deleted_at FROM form_submission_files WHERE id=?').get(first.body.data.file.fileId)).toEqual({ deleted_at: null });
  expect(sql.prepare('SELECT deletion_reason FROM form_submission_files WHERE id=?').get(second.body.data.file.fileId)).toEqual({ deletion_reason: 'abandoned' });
});
it('does not run a sixth check for an older pending row already at the limit', async () => {
  sql.exec(`INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_secret_ref,external_timeout_ms,updated_at) VALUES ('a','scanner','https://scan.example.com','FILE_SCAN_SECRET_PRIMARY',1000,'2026-01-01')`);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); })); await upload();
  sql.exec("UPDATE media_file_scans SET attempts=5, next_retry_at='2000-01-01'");
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect(await processDueFileScans(env())).toEqual({ processed: 1, stillPending: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT status,next_retry_at FROM media_file_scans').get()).toEqual({ status: 'rejected', next_retry_at: null });
});

describe('S01 invalid legacy database configuration', () => {
  it.each([
    ['ADMIN_API_KEY', 'https://scan.example.com'],
    ['FILE_SCAN_SECRET_PRIMARY', 'https://evil.example.com'],
    ['FILE_SCAN_SECRET_PRIMARY', 'https://scan.example.com:8443'],
  ])('uses only internal scanning on upload and retry without reading %s or sending to %s', async (name, endpoint) => {
    sql.prepare(`INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_secret_ref,external_timeout_ms,updated_at) VALUES ('a','scanner',?,?,1000,'2026-01-01')`).run(endpoint, name);
    const fetchMock = vi.fn(async () => Response.json({ verdict: 'clean' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf');
    expect(result.response.status).toBe(201);
    expect(result.body.data.scanStatus).toBe('clean');
    sql.exec("UPDATE media_file_scans SET status='pending',next_retry_at='2000-01-01'");
    await processDueFileScans(env());
    expect(sql.prepare('SELECT status FROM media_file_scans').get()).toEqual({ status: 'clean' });
    expect(secretReads).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it.each(['identity', 'mixed'])('refuses new %s uploads before storing or scanning bytes', async kind => {
  const result = await upload('front', png, 'image/png', kind);
  expect(result.response.status).toBe(400);
  expect(result.body.code).toBe('IDENTITY_DOCUMENT_DISABLED');
  expect(store.put).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT COUNT(*) AS n FROM form_submission_files').get()).toEqual({ n: 0 });
  expect(sql.prepare('SELECT COUNT(*) AS n FROM media_file_scans').get()).toEqual({ n: 0 });
});

it('still checks ordinary PDF ownership, version, block and reuse after identity intake is disabled', async () => {
  const result = await upload('single', new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'application/pdf', 'pdf');
  const fileId = result.body.data.file.fileId;
  const pdfLayout = layout();
  pdfLayout.sections[0].blocks = [{ ...block, fileKind: 'pdf', fileBothSides: false }];
  const data = () => ({ doc: [{ fileId }] });
  const scope = { accountId: 'a', formId: 'f', friendId: 'u', versionId: null as string | null };
  expect(await validateDocumentAnswers(db, pdfLayout, data(), scope)).toBeNull();
  for (const other of [{ accountId: 'other' }, { formId: 'other' }, { friendId: 'other' }, { versionId: 'other' }]) {
    expect(await validateDocumentAnswers(db, pdfLayout, data(), { ...scope, ...other })).not.toBeNull();
  }
  pdfLayout.sections[0].blocks[0].id = 'other-block';
  expect(await validateDocumentAnswers(db, pdfLayout, data(), scope)).not.toBeNull();
  pdfLayout.sections[0].blocks[0].id = block.id;
  await insertFormSubmissionRecord(db, { formId: 'f', friendId: 'u', data: '{}', fileIds: [fileId] });
  expect(await validateDocumentAnswers(db, pdfLayout, data(), scope)).toContain('すでに');
});
