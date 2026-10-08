import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { broadcasts } from './broadcasts.js';
import { forms } from './forms.js';
import { LineHarness } from '@line-harness/sdk';

let sql: SqliteD1;
let client: LineHarness;
let actorRole: 'owner' | 'staff';
beforeEach(() => {
  sql = createTestD1({ foreignKeys: true });
  actorRole = 'owner';
  sql.raw.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant-sdk', '試験');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('sdk-account', 'sdk-channel', '試験', 'token', 'secret', 'tenant-sdk');
    INSERT INTO staff_members (id, name, role, tenant_id, api_key) VALUES ('sdk-owner', '試験', 'owner', 'tenant-sdk', 'local-fixture');
    INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
    VALUES ('sdk-broadcast', '試験', 'text', '{{name}}さん', 'all', 'draft', 'sdk-account');
  `);
  insertFriend(sql.raw, 'sdk-friend', { line_account_id: 'sdk-account' });
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'sdk-owner', name: '試験', role: actorRole, readOnly: false,
      tenantId: 'tenant-sdk', permissionKeys: [] });
    await next();
  });
  app.route('/', broadcasts);
  app.route('/', forms);
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== 'https://sdk.example.test') throw new Error('external network forbidden');
    return app.fetch(request, { DB: sql.db, LINE_CHANNEL_ACCESS_TOKEN: 'token',
      WORKER_URL: 'https://sdk.example.test' } as Env['Bindings']);
  });
  client = new LineHarness({ apiUrl: 'https://sdk.example.test', apiKey: 'local-fixture', lineAccountId: 'sdk-account' });
});
afterEach(() => { vi.unstubAllGlobals(); sql.raw.close(); });

function broadcastRow() {
  return sql.raw.prepare(`SELECT status, total_count, lock_version, segment_conditions FROM broadcasts WHERE id = 'sdk-broadcast'`).get();
}

describe('PKG03 SDKとWorkerの明示確認（実SQL・実ルート）', () => {
  it('未確認は428で配信を変更しない', async () => {
    const before = broadcastRow();
    await expect(client.broadcasts.send('sdk-broadcast')).rejects.toMatchObject({ status: 428 });
    expect(broadcastRow()).toEqual(before);
  });
  it.each(['all', 'segment'] as const)('%s: 明示確認を渡して配信をキューに確定する', async (target) => {
    const confirmation = { confirmIrreversible: 'broadcast-send' as const };
    const result = target === 'all'
      ? await client.broadcasts.send('sdk-broadcast', confirmation)
      : await client.broadcasts.sendToSegment('sdk-broadcast', { operator: 'AND', rules: [{ type: 'is_following', value: true }] }, confirmation);
    expect(result.status).toBe('sending');
    expect(broadcastRow()).toMatchObject({ status: 'sending', ...(target === 'all'
      ? { total_count: 1 } : { segment_conditions: JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }) } ) });
  });
  it('確認があっても操作権限のないスタッフは配信を変更できない', async () => {
    actorRole = 'staff';
    const before = broadcastRow();
    await expect(client.broadcasts.send('sdk-broadcast', { confirmIrreversible: 'broadcast-send' })).rejects.toMatchObject({ status: 403 });
    expect(broadcastRow()).toEqual(before);
  });
});

// These annotations are checked by worker tsc as well as exercised over real SQL.
// Removing revision fields from the public SDK types must fail typecheck.
describe('PKG04 SDKの編集版とWorkerのCAS（実SQL）', () => {
  it('配信の版を取得して保存し、古い版の保存は409で状態を保つ', async () => {
    const loaded = await client.broadcasts.get('sdk-broadcast');
    const input: import('@line-harness/sdk').UpdateBroadcastInput = {
      title: '版付き保存', expectedVersion: loaded.version,
    };
    await client.broadcasts.update(loaded.id, input);
    const before = sql.raw.prepare(`SELECT * FROM broadcasts WHERE id = 'sdk-broadcast'`).get();
    await expect(client.broadcasts.update(loaded.id, { ...input, title: '古い保存' })).rejects.toMatchObject({ status: 409 });
    expect(sql.raw.prepare(`SELECT * FROM broadcasts WHERE id = 'sdk-broadcast'`).get()).toEqual(before);
  });
  it('フォームの編集版を取得して保存し、古い版の保存は409で状態を保つ', async () => {
    sql.raw.exec(`INSERT INTO forms (id, name, fields) VALUES ('sdk-form', '試験', '[]');
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('sdk-form', 'sdk-account');`);
    const loaded = await client.forms.get('sdk-form');
    const input: import('@line-harness/sdk').UpdateFormInput = {
      name: '版付き保存', expectedContentRevision: loaded.contentRevision,
    };
    await client.forms.update(loaded.id, input);
    const before = sql.raw.prepare(`SELECT * FROM forms WHERE id = 'sdk-form'`).get();
    await expect(client.forms.update(loaded.id, { ...input, name: '古い保存' })).rejects.toMatchObject({ status: 409 });
    expect(sql.raw.prepare(`SELECT * FROM forms WHERE id = 'sdk-form'`).get()).toEqual(before);
  });
});

describe('PKG05 LINE再受付の要求IDを実SQLに残す', () => {
  it('409では今回の要求IDでなく受付済みIDを保存する', async () => {
    const targetType = 'all';

    sql.raw.prepare(`UPDATE broadcasts SET message_content = '共通の案内', target_type = ?, target_tag_id = ? WHERE id = 'sdk-broadcast'`)
      .run(targetType, null);
    const transport = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin === 'https://api.line.me') return new Response('{"message":"already accepted"}', {
        status: 409, headers: { 'Content-Type': 'application/json', 'x-line-accepted-request-id': 'accepted-original', 'x-line-request-id': 'retry-request' },
      });
      return transport(input, init);
    });
    const result = await client.broadcasts.send('sdk-broadcast', { confirmIrreversible: 'broadcast-send' });
    expect(result.status).toBe('sent');
    expect(sql.raw.prepare(`SELECT line_request_id, status FROM broadcasts WHERE id = 'sdk-broadcast'`).get())
      .toEqual({ line_request_id: 'accepted-original', status: 'sent' });
  });
});


describe('PKG10 フォームの操作アカウントをSDKから実SQLまで渡す', () => {
  it('既定アカウントで作成・一覧・回答取得でき、削除の版と公開中の保護を守る', async () => {
    const input = { name: 'SDK作成', fields: [{ name: 'email', label: 'メール', type: 'email' as const }] };
    const created = await client.forms.create(input);
    expect(sql.raw.prepare('SELECT line_account_id FROM form_accounts WHERE form_id = ?').get(created.id))
      .toEqual({ line_account_id: 'sdk-account' });
    expect((await client.forms.list()).map((form) => form.id)).toEqual([created.id]);
    expect(await client.forms.getSubmissions(created.id)).toEqual([]);
    expect(input).not.toHaveProperty('accountId');
    await expect(client.forms.delete(created.id)).rejects.toMatchObject({ status: 400 });
    await expect(client.forms.delete(created.id, { expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(sql.raw.prepare('SELECT id FROM forms WHERE id = ?').get(created.id)).toEqual({ id: created.id });
  });
  it('別アカウントには既定アカウントのフォームを見せず変更も許さない', async () => {
    sql.raw.exec(`INSERT INTO line_accounts (id, channel_id, name, tenant_id, channel_access_token, channel_secret) VALUES ('other-sdk', 'other-channel', '別', 'tenant-sdk', 'token', 'secret');
      INSERT INTO forms (id, name, fields) VALUES ('private-sdk-form', '別口', '[]');
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('private-sdk-form', 'other-sdk');`);
    expect(await client.forms.list()).toEqual([]);
    await expect(client.forms.get('private-sdk-form')).rejects.toMatchObject({ status: 404 });
    await expect(client.forms.update('private-sdk-form', { name: '不正', expectedContentRevision: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(client.forms.delete('private-sdk-form', { expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
    expect(sql.raw.prepare("SELECT name, content_revision FROM forms WHERE id = 'private-sdk-form'").get())
      .toEqual({ name: '別口', content_revision: 1 });
  });
});
