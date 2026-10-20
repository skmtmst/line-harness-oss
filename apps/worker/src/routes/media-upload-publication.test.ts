import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { mediaUploadKey } from '../services/media-upload-storage.js';
import type { Env } from '../worker-env.js';

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: async () => true }));
const handlers = await import('./contents-uploads-handlers.js');
const { images } = await import('./images.js');
const { processDueFileScans } = await import('./file-scan.js');
const { createFileScan } = await import('../services/file-scan.js');
const { post__api_rich_menu_groups_8: createRichMenu } = await import('./rich-menu-groups-configuration.js');
const { get__media_id_content_1: liveContent } = await import('./contents-media-lifecycle-handlers.js');

// Include dimensions and IEND, with a distinct hostile trailing-data variant.
const clean = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,0,0,0,0,73,69,78,68,174,66,96,130]);
const hostile = new Uint8Array([...clean, 60, 115, 99, 114, 105, 112, 116, 62]);
type Stored = { bytes: Uint8Array; etag: string; httpMetadata: { contentType: string }; customMetadata: Record<string, string> };
class Bucket {
  objects = new Map<string, Stored>();
  reads: string[] = [];
  beforeGet?: (key: string, options: R2GetOptions | undefined) => void;
  afterGet?: (key: string, options: R2GetOptions | undefined) => void;
  seed(key: string, bytes = clean, etag = 'initial', session = 'session') {
    this.objects.set(key, { bytes: bytes.slice(), etag, httpMetadata: { contentType: 'image/png' }, customMetadata: { 'line-account-id': 'account', 'upload-session-id': session } });
  }
  async head(key: string) {
    const value = this.objects.get(key);
    return value ? { ...value, size: value.bytes.length } : null;
  }
  async get(key: string, options?: R2GetOptions) {
    this.beforeGet?.(key, options);
    this.reads.push(key);
    const value = this.objects.get(key);
    if (!value) return null;
    const expected = (options?.onlyIf as R2Conditional | undefined)?.etagMatches;
    if (expected && expected !== value.etag) return { etag: value.etag };
    let bytes = value.bytes.slice();
    const range = options?.range;
    if (range && 'offset' in range) bytes = bytes.slice(range.offset ?? 0, (range.offset ?? 0) + (range.length ?? bytes.length));
    else if (range && 'suffix' in range) bytes = bytes.slice(-range.suffix);
    const snapshot = { ...value, size: value.bytes.length, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer };
    this.afterGet?.(key, options);
    return snapshot;
  }
  async put(key: string, body: ReadableStream | Uint8Array, options: R2PutOptions) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { bytes, etag: `final-${key}`, httpMetadata: options.httpMetadata as { contentType: string }, customMetadata: {} });
  }
  async delete(key: string) { this.objects.delete(key); }
}
let db: SqliteD1;
let bucket: Bucket;
let app: Hono<Env>;
let reserved: string;
function insertSession(id = 'session', target: string | null = null, key = reserved, status = 'pending', size = clean.length, expiresAt = '2099-01-01T00:00:00Z') {
  db.raw.prepare(`INSERT INTO media_upload_sessions (id,line_account_id,target_media_id,filename,kind,expected_mime,expected_size,r2_key,status,expires_at,width,height)
    VALUES (?,'account',?,'photo.png','image','image/png',?,?,?,?,1,1)`).run(id,target,size,key,status,expiresAt);
}
function post(path: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db.db, IMAGES: bucket } as unknown as Env['Bindings']);
}
function complete(id = 'session', etag = 'initial') { return post(`/complete/${id}`, { accountId: 'account', etag }); }
function image(key: string, conditional = false) {
  return app.request(`/images/${key}`, { headers: conditional ? { 'If-None-Match': '*' } : {} }, { DB: db.db, IMAGES: bucket } as unknown as Env['Bindings']);
}
function session(id = 'session') { return db.raw.prepare('SELECT * FROM media_upload_sessions WHERE id=?').get(id) as { r2_key: string; result_media_id: string; status: string }; }
async function publishReplacement(id: string, mediaId: string) {
  const preview = await post(`/preview/${mediaId}`, { accountId: 'account', uploadSessionId: id });
  const body = await preview.json() as { data: { previewToken: string } };
  return post(`/versions/${mediaId}`, { accountId: 'account', uploadSessionId: id, previewToken: body.data.previewToken, changeReason: '写真を更新' });
}
beforeEach(() => {
  vi.stubGlobal('FixedLengthStream', class extends TransformStream {
    constructor(size: number) {
      let count = 0;
      super({ transform(chunk, controller) { count += chunk.length; controller.enqueue(chunk); }, flush() { if (count !== size) throw new Error('length mismatch'); } });
    }
  });
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('account','synthetic','synthetic','synthetic','synthetic',?)`).run(DEFAULT_TENANT_ID);
  bucket = new Bucket();
  reserved = 'media/account/final/reserved.png';
  insertSession();
  bucket.seed(mediaUploadKey('session'));
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'owner', name: 'synthetic', role: 'owner', readOnly: false }); await next(); });
  app.post('/rich-menus', createRichMenu);
  app.post('/sessions', handlers.post__api_media_upload_sessions_2);
  app.post('/complete/:id', handlers.post__api_media_upload_sessions_id_complete_3);
  app.post('/preview/:id', handlers.post__api_media_id_replacement_preview_5);
  app.post('/versions/:id', handlers.post__api_media_id_versions_4);
  app.get('/content/:id', handlers.get__api_media_id_content_10);
  app.get('/live/:id', liveContent);
  app.get('/historical/:id/:versionNo', handlers.get__api_media_id_versions_versionNo_download_11);
  app.route('/', images);
});
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); });

describe('upload bytes and published media share one immutable result', () => {
  it('keeps finalized bytes clean when a PUT capability is reused before or after completion', async () => {
    bucket.seed(mediaUploadKey('session'), clean, 'latest');
    expect((await complete('session', 'latest')).status).toBe(201);
    const done = session();
    expect(done.r2_key).not.toBe(reserved);
    expect(done.r2_key).not.toBe(mediaUploadKey('session'));
    bucket.seed(mediaUploadKey('session'), hostile, 'overwrite');
    const response = await image(done.r2_key);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(clean);
    expect((await image(mediaUploadKey('session'))).status).toBe(404);
  });
  it.each(['prefix', 'full'])('rejects a swap between HEAD and the %s GET', async phase => {
    bucket.beforeGet = (key, options) => {
      if (key === mediaUploadKey('session') && (phase === 'prefix' ? !!options?.range : !options?.range)) bucket.seed(key, hostile, 'changed');
    };
    expect((await complete()).status).toBe(409);
    expect(db.raw.prepare('SELECT count(*) AS n FROM media').get()).toEqual({ n: 0 });
    expect([...bucket.objects.keys()].some(key => key.startsWith('media/'))).toBe(false);
  });
  it('copies a stable GET snapshot if the PUT target changes during copying', async () => {
    bucket.afterGet = (key, options) => { if (key === mediaUploadKey('session') && !options?.range) bucket.seed(key, hostile, 'changed'); };
    expect((await complete()).status).toBe(201);
    expect(bucket.objects.get(session().r2_key)?.bytes).toEqual(clean);
  });
  it('a completion race publishes one media and only deletes losing copies', async () => {
    const responses = await Promise.all([complete(), complete()]);
    expect(responses.map(res => res.status).every(status => status === 200 || status === 201)).toBe(true);
    expect(db.raw.prepare('SELECT count(*) AS n FROM media').get()).toEqual({ n: 1 });
    expect([...bucket.objects.keys()].filter(key => key.startsWith('media/'))).toEqual([session().r2_key]);
    expect((await image(session().r2_key)).status).toBe(200);
  });
  it('blocks incomplete and quarantined media before both body and conditional cache responses', async () => {
    expect((await image(reserved, true)).status).toBe(404);
    expect((await complete()).status).toBe(201);
    const key = session().r2_key;
    db.raw.prepare("UPDATE media_file_scans SET status='quarantined' WHERE subject_id='session'").run();
    bucket.reads = [];
    expect((await image(key)).status).toBe(409);
    expect((await image(key, true)).status).toBe(409);
    expect(bucket.reads).toEqual([]);
  });
  it('requires a clean replacement scan and preserves delivery of historical published versions', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    insertSession('replacement', old.result_media_id, 'media/account/final/reserved2.png');
    bucket.seed(mediaUploadKey('replacement'), clean, 'next', 'replacement');
    expect((await complete('replacement', 'next')).status).toBe(200);
    db.raw.prepare("UPDATE media_file_scans SET status='pending' WHERE subject_id='replacement'").run();
    expect((await publishReplacement('replacement', old.result_media_id)).status).toBe(409);
    db.raw.prepare("UPDATE media_file_scans SET status='clean' WHERE subject_id='replacement'").run();
    expect((await publishReplacement('replacement', old.result_media_id)).status).toBe(201);
    expect((await image(session('replacement').r2_key)).status).toBe(200);
    expect((await image(old.r2_key)).status).toBe(200);
    expect((await image(old.r2_key, true)).status).toBe(304);
  });
  it('does not publish a format-verified legacy replacement without a safety scan', async () => {
    expect((await complete()).status).toBe(201);
    insertSession('old-replacement', session().result_media_id, 'media/account/old.png', 'verified');
    expect((await publishReplacement('old-replacement', session().result_media_id)).status).toBe(409);
  });
  it('finalizes a legacy pending PUT target into a distinct server-only key', async () => {
    db.raw.prepare("UPDATE media_upload_sessions SET r2_key='media/account/legacy.png' WHERE id='session'").run();
    bucket.seed('media/account/legacy.png');
    expect((await complete()).status).toBe(201);
    bucket.seed('media/account/legacy.png', hostile, 'changed');
    expect((await image('media/account/legacy.png', true)).status).toBe(404);
    expect((await image(session().r2_key)).status).toBe(200);
  });
  it('keeps legacy completed keys gated until expiry and pins delivery after expiry even against a late PUT', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    const key = 'media/account/legacy-completed.png';
    bucket.seed(key);
    db.raw.prepare('UPDATE media SET r2_key=? WHERE id=?').run(key, old.result_media_id);
    db.raw.prepare('UPDATE media_versions SET r2_key=? WHERE media_id=?').run(key, old.result_media_id);
    db.raw.prepare("UPDATE media_upload_sessions SET r2_key=? WHERE id='session'").run(key);
    expect((await image(key, true)).status).toBe(409);
    db.raw.prepare("UPDATE media_upload_sessions SET expires_at='2000-01-01T00:00:00Z' WHERE id='session'").run();
    expect((await image(key)).status).toBe(200);
    bucket.beforeGet = (readKey, options) => { if (readKey === key && !options?.range) bucket.seed(key, hostile, 'late-put'); };
    expect((await image(key, true)).status).toBe(404);
    for (const path of [`/content/${old.result_media_id}?accountId=account`, `/live/${old.result_media_id}`, `/historical/${old.result_media_id}/1?accountId=account`]) {
      expect((await app.request(path, {}, { DB: db.db, IMAGES: bucket } as unknown as Env['Bindings'])).status).toBe(404);
    }
  });
  it('keeps a clean incoming replacement blocked while its parent is quarantined', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    insertSession('replacement', old.result_media_id, 'media/account/final/reserved2.png');
    bucket.seed(mediaUploadKey('replacement'), clean, 'next', 'replacement');
    expect((await complete('replacement', 'next')).status).toBe(200);
    const scan = await createFileScan(db.db, { lineAccountId: 'account', subjectKind: 'media', subjectId: old.result_media_id, mediaId: old.result_media_id, filename: 'photo.png', mimeType: 'image/png', sizeBytes: clean.length });
    db.raw.prepare("UPDATE media_file_scans SET status='quarantined' WHERE id=?").run(scan.id);
    expect((await publishReplacement('replacement', old.result_media_id)).status).toBe(409);
    expect((await image(old.r2_key, true)).status).toBe(409);
  });
  it('retries a historical version scan against its own object rather than the current replacement', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    insertSession('replacement', old.result_media_id, 'media/account/final/reserved2.png');
    bucket.seed(mediaUploadKey('replacement'), clean, 'next', 'replacement');
    expect((await complete('replacement', 'next')).status).toBe(200);
    expect((await publishReplacement('replacement', old.result_media_id)).status).toBe(201);
    const version = db.raw.prepare('SELECT id FROM media_versions WHERE media_id=? AND version_no=1').get(old.result_media_id) as {id: string};
    // R2's copied object keeps the same content ETag; align the test's artificial ETag.
    db.raw.prepare('UPDATE media_versions SET etag=? WHERE id=?').run(bucket.objects.get(old.r2_key)!.etag, version.id);
    await createFileScan(db.db, { lineAccountId: 'account', subjectKind: 'media_version', subjectId: version.id, mediaId: old.result_media_id, filename: 'photo.png', mimeType: 'image/png', sizeBytes: clean.length });
    db.raw.prepare("UPDATE media_file_scans SET next_retry_at='2000-01-01T00:00:00Z' WHERE subject_id=?").run(version.id);
    bucket.reads = [];
    await processDueFileScans({ DB: db.db, IMAGES: bucket } as unknown as Env['Bindings']);
    expect(bucket.reads).toEqual([old.r2_key]);
    expect(db.raw.prepare("SELECT status FROM media_file_scans WHERE subject_id=?").get(version.id)).toEqual({ status: 'clean' });
  });

  it('preserves an archived published image and legacy media without upload sessions', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    const key = 'media/account/legacy-import.png';
    bucket.seed(key);
    db.raw.prepare('UPDATE media SET r2_key=?, archived_at=? WHERE id=?').run(key, '2026-10-01', old.result_media_id);
    db.raw.prepare('UPDATE media_versions SET r2_key=? WHERE media_id=?').run(key, old.result_media_id);
    db.raw.prepare("DELETE FROM media_upload_sessions WHERE id='session'").run();
    expect((await image(key)).status).toBe(200);
    expect((await image(key, true)).status).toBe(304);
  });

  it('signs only a private PUT target while reserving a distinct published key', async () => {
    const response = await app.request('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'account', files: [{ filename: 'photo.png', mimeType: 'image/png', sizeBytes: clean.length }] }) }, {
      DB: db.db, IMAGES: bucket, CF_ACCOUNT_ID: 'synthetic-account', MEDIA_R2_ACCESS_KEY_ID: 'synthetic-access', MEDIA_R2_SECRET_ACCESS_KEY: 'synthetic-secret', MEDIA_R2_BUCKET_NAME: 'synthetic-bucket',
    } as unknown as Env['Bindings']);
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { sessions: Array<{ id: string; uploadUrl: string }> } };
    const created = body.data.sessions[0];
    expect(new URL(created.uploadUrl).pathname).toBe(`/synthetic-bucket/${mediaUploadKey(created.id)}`);
    expect(session(created.id).r2_key).toMatch(/^media\/account\/final\//);
    expect(created.uploadUrl).not.toContain(session(created.id).r2_key);
  });
  it('retries a missing legacy version rather than asking an external scanner to approve empty bytes', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    const key = 'media/account/legacy-delayed.png';
    db.raw.prepare('UPDATE media SET r2_key=? WHERE id=?').run(key, old.result_media_id);
    db.raw.prepare('UPDATE media_versions SET r2_key=? WHERE media_id=?').run(key, old.result_media_id);
    db.raw.prepare("UPDATE media_upload_sessions SET r2_key=?, expires_at='2000-01-01T00:00:00Z' WHERE id='session'").run(key);
    const version = db.raw.prepare('SELECT id FROM media_versions WHERE media_id=?').get(old.result_media_id) as { id: string };
    const scan = await createFileScan(db.db, { lineAccountId: 'account', subjectKind: 'media_version', subjectId: version.id, mediaId: old.result_media_id, filename: 'photo.png', mimeType: 'image/png', sizeBytes: clean.length });
    db.raw.prepare("UPDATE media_file_scans SET next_retry_at='2000-01-01T00:00:00Z' WHERE id=?").run(scan.id);
    db.raw.prepare("INSERT INTO file_scan_configs(line_account_id,external_provider,external_endpoint_url,external_secret_ref) VALUES ('account','synthetic','https://scan.example.com/check','FILE_SCAN_SECRET_PRIMARY')").run();
    const fetch = vi.fn(async () => Response.json({ verdict: 'clean' }));
    vi.stubGlobal('fetch', fetch);
    const env = { DB: db.db, IMAGES: bucket, FILE_SCAN_ALLOWED_PAIRS: 'scan.example.com=FILE_SCAN_SECRET_PRIMARY', FILE_SCAN_SECRET_PRIMARY: 'synthetic-token' } as unknown as Env['Bindings'];
    await processDueFileScans(env);
    expect(fetch).not.toHaveBeenCalled();
    expect(db.raw.prepare('SELECT status, attempts FROM media_file_scans WHERE id=?').get(scan.id)).toEqual({ status: 'pending', attempts: 1 });
    bucket.seed(key);
    db.raw.prepare("UPDATE media_file_scans SET next_retry_at='2000-01-01T00:00:00Z' WHERE id=?").run(scan.id);
    await processDueFileScans(env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.raw.prepare('SELECT status FROM media_file_scans WHERE id=?').get(scan.id)).toEqual({ status: 'clean' });
    expect((await image(key)).status).toBe(200);
  });

  it('leaves a lazy legacy version scan pending when the object differs from its published ETag', async () => {
    expect((await complete()).status).toBe(201);
    const old = session();
    const key = 'media/account/legacy-rewritten.png';
    db.raw.prepare('UPDATE media SET r2_key=? WHERE id=?').run(key, old.result_media_id);
    db.raw.prepare('UPDATE media_versions SET r2_key=? WHERE media_id=?').run(key, old.result_media_id);
    db.raw.prepare("UPDATE media_upload_sessions SET r2_key=?, expires_at='2000-01-01T00:00:00Z' WHERE id='session'").run(key);
    bucket.seed(key, clean, 'different-content');
    const conditions: unknown[] = [];
    bucket.beforeGet = (readKey, options) => { if (readKey === key) conditions.push(options?.onlyIf); };
    expect((await image(key)).status).toBe(409);
    const version = db.raw.prepare('SELECT id FROM media_versions WHERE media_id=?').get(old.result_media_id) as { id: string };
    expect(db.raw.prepare('SELECT status FROM media_file_scans WHERE subject_kind=? AND subject_id=?').get('media_version', version.id)).toEqual({ status: 'pending' });
    expect(conditions).toEqual([{ etagMatches: 'initial' }]);
  });

  it('does not copy quarantined registered bytes into a public rich-menu image, and preserves the draft and clean workflow', async () => {
    const rich = clean.slice();
    new DataView(rich.buffer).setUint32(16, 2500);
    new DataView(rich.buffer).setUint32(20, 1686);
    bucket.seed(mediaUploadKey('session'), rich);
    expect((await complete()).status).toBe(201);
    const mediaId = session().result_media_id;
    db.raw.prepare("UPDATE media_file_scans SET status='quarantined' WHERE subject_id='session'").run();
    const body = { accountId: 'account', name: 'Synthetic menu', chatBarText: 'Menu', size: 'large', pages: [{ name: 'Home', orderIndex: 0, areas: [] }], imageMediaId: mediaId };
    const blocked = await post('/rich-menus', body);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ success: false, data: { status: 'draft' } });
    expect([...bucket.objects.keys()].some(key => key.startsWith('rich-menus/'))).toBe(false);
    expect(db.raw.prepare('SELECT count(*) AS n FROM rich_menu_groups').get()).toEqual({ n: 1 });
    db.raw.prepare("UPDATE media_file_scans SET status='clean' WHERE subject_id='session'").run();
    expect((await post('/rich-menus', { ...body, name: 'Clean menu' })).status).toBe(200);
    const copied = [...bucket.objects.keys()].find(key => key.startsWith('rich-menus/'))!;
    expect(copied).toBeTruthy();
    expect(bucket.objects.get(copied)?.bytes).toEqual(rich);
    expect((await image(copied)).status).toBe(200);
  });

  it('preserves a pending parent scan even when an exact upload scan is clean', async () => {
    expect((await complete()).status).toBe(201);
    const done = session();
    await createFileScan(db.db, { lineAccountId: 'account', subjectKind: 'media', subjectId: done.result_media_id, mediaId: done.result_media_id, filename: 'photo.png', mimeType: 'image/png', sizeBytes: clean.length });
    bucket.reads = [];
    expect((await image(done.r2_key, true)).status).toBe(409);
    expect(bucket.reads).toEqual([]);
  });
  it.each(['media/account/old.png', 'media/account/old-without-extension'])('keeps a historical PNG with key %s readable after a JPEG replacement changes the display name', async key => {
    expect((await complete()).status).toBe(201);
    const done = session();
    bucket.seed(key);
    db.raw.prepare("UPDATE media SET r2_key='media/account/new.jpg', filename='new.jpg', mime_type='image/jpeg' WHERE id=?").run(done.result_media_id);
    db.raw.prepare('UPDATE media_versions SET r2_key=? WHERE media_id=?').run(key, done.result_media_id);
    db.raw.prepare("DELETE FROM media_upload_sessions WHERE id='session'").run();
    const response = await image(key);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(clean);
    expect(db.raw.prepare("SELECT status, mime_type FROM media_file_scans WHERE subject_kind='media_version' AND media_id=?").get(done.result_media_id)).toEqual({ status: 'clean', mime_type: 'image/png' });
  });

});
