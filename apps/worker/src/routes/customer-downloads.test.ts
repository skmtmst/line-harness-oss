import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { app as worker } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { customerDownloads } from './customer-downloads.js';
import { chatAttachments } from './chat-attachments.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { attachmentBucket, PDF_BYTES } from '../test-utils/chat-attachment-bucket.js';
import { attachmentUrl, CHAT_ATTACHMENT_PREFIX, metadataFor } from '../services/chat-attachments.js';
import { customerDownloadEntry, customerLiffDownload } from '../services/download-entrypoints.js';
import type { ChatAttachment } from '@line-crm/shared';

let db: SqliteD1;
let storage: ReturnType<typeof attachmentBucket>;
let env: Env['Bindings'];
let file: ChatAttachment;
const identity = vi.fn(async (_input: unknown, init?: RequestInit) => {
  const body = init?.body as URLSearchParams;
  const token = body?.get('id_token');
  const channel = body?.get('client_id');
  const sub = token === 'alice-id' && channel === 'login-a' ? 'U-alice'
    : token === 'bob-id' && channel === 'login-a' ? 'U-bob'
    : token === 'other-shop-id' && channel === 'login-b' ? 'U-alice' : null;
  return Response.json(sub ? { sub } : {}, { status: sub ? 200 : 400 });
});
const routes = new Hono<Env>();
routes.use('*', authMiddleware);
routes.route('/', customerDownloads);
routes.route('/', chatAttachments);
routes.get('/images/unrelated-fixture', c => c.text('public fixture', 200, { 'Cache-Control': 'public, max-age=60' }));
const request = (path: string, token?: string, init?: RequestInit) => routes.request(path, {
  ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
}, env);
const issue = (token = 'alice-id', id = file.id) => request(`/api/liff/files/${id}/download`, token);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', identity);
  db = createTestD1(); storage = attachmentBucket();
  db.raw.exec(`INSERT INTO tenants(id,name) VALUES('org-a','店Aの統括'),('org-b','店Bの統括');
    INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,login_channel_id,liff_id,tenant_id)
    VALUES('a','店A','channel-a','test-a','test-a','login-a','liff-a','org-a'),
          ('b','店B','channel-b','test-b','test-b','login-b','liff-b','org-b');
    INSERT INTO friends(id,line_user_id,display_name,line_account_id)
    VALUES('alice','U-alice','見本A','a'),('bob','U-bob','見本B','a'),('other-shop','U-other','見本C','b');`);
  env = { DB: db.db, IMAGES: storage.bucket, API_KEY: 'fixture-only-download-key', WORKER_URL: 'https://worker.example' } as Env['Bindings'];
  file = { id: crypto.randomUUID(), key: '', url: '', filename: '見本.pdf', kind: 'file', mimeType: 'application/pdf', size: PDF_BYTES.length,
    expiresAt: new Date(Date.now() + 86400000).toISOString() };
  file.key = `${CHAT_ATTACHMENT_PREFIX}${file.id}`; file.url = attachmentUrl(env.WORKER_URL!, file.id);
  await storage.bucket.put(file.key, PDF_BYTES, { httpMetadata: { contentType: file.mimeType }, customMetadata: metadataFor(file, { friendId: 'alice', lineAccountId: 'a' }) });
});
afterEach(() => { db.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('本人向けファイルの取り直し', () => {
  it('本人だけに新しい15分URLを返し、取得時にも本人を確かめる', async () => {
    // 発行と検査を同じ時計にする。署名の秒丸めと実行時間を混同しない。
    const issuedNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(issuedNow);
    const response = await issue();
    expect(response.status).toBe(200);
    const { data } = await response.json<{ data: { url: string; expiresAt: string; filename: string } }>();
    expect(data.filename).toBe(file.filename);
    expect(Date.parse(data.expiresAt) - Date.now()).toBeGreaterThan(899000);
    expect(Date.parse(data.expiresAt) - Date.now()).toBeLessThanOrEqual(900000);
    expect(data.url).not.toMatch(/alice|org-a|alice-id|friendId|lineAccessToken/);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(storage.mock.get).not.toHaveBeenCalled();
    expect((await request(data.url)).status).toBe(403);
    expect((await request(data.url, 'bob-id')).status).toBe(403);
    expect((await request(data.url, 'other-shop-id')).status).toBe(403);
    const got = await request(data.url, 'alice-id');
    expect(got.status).toBe(200); expect(await got.text()).toBe(new TextDecoder().decode(PDF_BYTES));
    clock.mockReturnValue(Date.parse(data.expiresAt));
    expect((await request(data.url, 'alice-id')).status).toBe(403);
    const fresh = await issue(); expect(fresh.status).toBe(200);
    const newer = (await fresh.json<{ data: { url: string } }>()).data.url;
    expect(newer).not.toBe(data.url); expect((await request(newer, 'alice-id')).status).toBe(200);
    clock.mockRestore();
  });
  it.each(['bob-id', 'other-shop-id', 'invalid', 'test-a'])('%sから発行できず、中身も所有者も返さない', async token => {
    const res = await issue(token); expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/見本.pdf|alice|org-a|signature/);
    expect(storage.mock.get).not.toHaveBeenCalled();
  });
  it('認証情報をqueryに載せても発行できず、LINEの照合前に止める', async () => {
    expect((await request(`/api/liff/files/${file.id}/download?lineAccessToken=alice-id`)).status).toBe(401);
    expect(identity).not.toHaveBeenCalled();
  });
  it.each(['deleted', 'friend-deleted', 'friend-moved', 'owner-changed', 'shop-changed', 'inactive', 'archived', 'tenant-suspended', 'tenant-archived', 'tenant-missing', 'expired', 'invalid-expiry', 'missing-expiry'])('%sの物を発行しない', async state => {
    if (state === 'deleted') await storage.bucket.delete(file.key);
    if (state === 'friend-deleted') db.raw.exec("DELETE FROM friends WHERE id='alice'");
    if (state === 'friend-moved') db.raw.exec("UPDATE friends SET line_account_id='b' WHERE id='alice'");
    if (state === 'owner-changed') storage.objects.get(file.key)!.meta.customMetadata!.friendId = 'bob';
    if (state === 'shop-changed') storage.objects.get(file.key)!.meta.customMetadata!.lineAccountId = 'b';
    if (state === 'inactive') db.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='a'");
    if (state === 'archived') db.raw.exec("UPDATE line_accounts SET archived_at='2026-01-01' WHERE id='a'");
    if (state.startsWith('tenant-')) db.raw.exec(`UPDATE tenants SET status='${state === 'tenant-suspended' ? 'suspended' : 'archived'}' WHERE id='org-a'`);
    if (state === 'tenant-missing') db.raw.exec("UPDATE line_accounts SET tenant_id='missing' WHERE id='a'");
    if (state.endsWith('expiry') || state === 'expired') storage.objects.get(file.key)!.meta.customMetadata!.expiresAt = state === 'expired' ? '2000-01-01T00:00:00Z' : state === 'missing-expiry' ? '' : 'invalid';
    const res = await issue(); expect(res.status).toBe(404);
    expect(storage.mock.get).not.toHaveBeenCalled();
  });
  it('取得する直前に消した物・所属を変えた物も拒む', async () => {
    const { data } = await (await issue()).json<{ data: { url: string } }>();
    db.raw.exec("UPDATE friends SET line_account_id='b' WHERE id='alice'");
    expect((await request(data.url, 'alice-id')).status).toBe(403);
    db.raw.exec("UPDATE friends SET line_account_id='a' WHERE id='alice'");
    await storage.bucket.delete(file.key);
    expect((await request(data.url, 'alice-id')).status).toBe(404);
    expect(storage.mock.get).not.toHaveBeenCalled();
  });
  it('署名を別ファイルに移す・改ざん・鍵不足を拒む', async () => {
    const { data } = await (await issue()).json<{ data: { url: string } }>();
    const otherId = crypto.randomUUID();
    await storage.bucket.put(`${CHAT_ATTACHMENT_PREFIX}${otherId}`, PDF_BYTES, { customMetadata: metadataFor(file, { friendId: 'alice', lineAccountId: 'a' }) });
    expect((await request(data.url.replace(file.id, otherId), 'alice-id')).status).toBe(403);
    const forged = new URL(data.url); forged.searchParams.set('signature', '0'.repeat(64));
    expect((await request(forged.toString(), 'alice-id')).status).toBe(403);
    env.API_KEY = ''; expect((await issue()).status).toBe(503);
    expect(storage.mock.get).not.toHaveBeenCalled();
  });
  it('全Workerでも管理ログインを要求せず、LINE本人を照合して発行する', async () => {
    const res = await worker.request(`/api/liff/files/${file.id}/download`, { headers: { Authorization: 'Bearer alice-id' } }, env);
    expect(res.status).toBe(200);
  });
});

describe('古いリンクと長く使えるLIFF入口', () => {
  it('署名なしリンクから本文を返さず案内し、持ち主のLIFFへ移る', async () => {
    const old = await request(`${file.url}?lineAccessToken=do-not-copy&next=https://evil.example`);
    expect(old.status).toBe(303);
    const entry = customerDownloadEntry(env.WORKER_URL!, 'files', file.id);
    expect(old.headers.get('location')).toBe(entry);
    const gateway = await worker.request(entry, {}, env);
    expect(gateway.status).toBe(303);
    expect(gateway.headers.get('location')).toBe(`https://liff.line.me/liff-a/files/?id=${file.id}&liffId=liff-a`);
    expect(gateway.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await old.text()).not.toContain('%PDF'); expect(storage.mock.get).not.toHaveBeenCalled();
    expect(identity).not.toHaveBeenCalled();
  });
  it('削除済み・設定なしも404直行にせず問い合わせ先を案内し、内容は返さない', async () => {
    await storage.bucket.delete(file.key);
    const old = await request(file.url); expect(old.status).toBe(303);
    const gateway = await request(old.headers.get('location')!);
    expect(gateway.status).toBe(410); expect(await gateway.text()).toContain('お店へお問い合わせ');
    expect(storage.mock.get).not.toHaveBeenCalled();
  });
  it('他の経路のキャッシュ・ヘッダーに影響しない', async () => {
    const response = await request('/images/unrelated-fixture');
    expect(response.headers.get('Referrer-Policy')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
  it('外のURL・クエリ・ID中の記号をLIFFの遷移先に使えない', () => {
    expect(customerLiffDownload('https://evil.example', 'files', file.id)).toBeNull();
    expect(customerLiffDownload('liff-a?redirect=evil', 'files', file.id)).toBeNull();
    expect(customerLiffDownload(null, 'files', file.id)).toBeNull();
  });
});
