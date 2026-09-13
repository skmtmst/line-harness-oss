import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../services/plain-mail.js', () => ({ sendPlainMail: mail.send }));

const { hqSupport } = await import('./hq-support.js');

let testDb: SqliteD1;
let r2Store: Map<string, { bytes: Uint8Array; contentType: string }>;

const staffOf = (overrides: Partial<AuthenticatedStaff> = {}): AuthenticatedStaff => ({
  id: 'staff-1',
  name: '坂本 真人',
  role: 'admin',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
  ...overrides,
});

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    return next();
  });
  instance.route('/', hqSupport);
  return instance;
}

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: testDb.db,
    IMAGES: {
      put: vi.fn(async (key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        r2Store.set(key, { bytes: value, contentType: opts?.httpMetadata?.contentType ?? '' });
      }),
    } as unknown as R2Bucket,
    WORKER_URL: 'https://api.example.com',
    CONTACT_EMAIL: 'ops@example.com',
    ...overrides,
  } as Env['Bindings'];
}

async function call(method: string, path: string, body?: unknown, opts: { staff?: AuthenticatedStaff; env?: Partial<Env['Bindings']> } = {}) {
  return app(opts.staff ?? staffOf()).request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env(opts.env));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const REQUEST = { kind: 'bug', subject: 'バナー生成で文字が崩れる', body: '2枚に1枚は誤字になります。' };

beforeEach(() => {
  testDb = createTestD1();
  r2Store = new Map();
  mail.send.mockReset();
  testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-2', '別の統括')").run();
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, tenant_id) VALUES ('staff-1', '坂本 真人', 'masato@example.com', 'admin', 'key-1', ?)`,
  ).run(DEFAULT_TENANT_ID);
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '然-NEN- TEST', '', '', 1, ?)`,
  ).run(DEFAULT_TENANT_ID);
});

describe('統括からのお問い合わせ', () => {
  it('送ると記録が残り、運営へ知らせ、送信者に控えを送る', async () => {
    const res = await call('POST', '/api/hq/support/requests', { ...REQUEST, lineAccountId: 'account-1' });
    expect(res.status).toBe(201);
    const data = (await res.json<{ data: { id: string; kindLabel: string; notified: boolean; status: string } }>()).data;
    expect(data.kindLabel).toBe('不具合の報告');
    expect(data.notified).toBe(true);
    expect(data.status).toBe('open');

    expect(mail.send).toHaveBeenCalledTimes(2);
    const [operator, copy] = mail.send.mock.calls.map((c) => c[1] as { to: string; subject: string; body: string });
    expect(operator.to).toBe('ops@example.com');
    expect(operator.subject).toContain('不具合の報告');
    expect(operator.body).toContain('関係する店舗: 然-NEN- TEST');
    expect(operator.body).toContain('masato@example.com');
    expect(copy.to).toBe('masato@example.com');
    expect(copy.subject).toContain('受け付けました');

    const list = await call('GET', '/api/hq/support/requests');
    const items = (await list.json<{ data: Array<{ id: string; subject: string }> }>()).data;
    expect(items.map((i) => i.subject)).toEqual(['バナー生成で文字が崩れる']);
  });

  it('SUPPORT_NOTIFY_EMAIL があればそちらへ知らせる', async () => {
    await call('POST', '/api/hq/support/requests', REQUEST, { env: { SUPPORT_NOTIFY_EMAIL: 'support@example.com' } });
    expect((mail.send.mock.calls[0][1] as { to: string }).to).toBe('support@example.com');
  });

  it('メールが送れなくても記録は残り、notified が false になる', async () => {
    mail.send.mockRejectedValue(new Error('smtp down'));
    const res = await call('POST', '/api/hq/support/requests', REQUEST);
    expect(res.status).toBe(201);
    expect((await res.json<{ data: { notified: boolean } }>()).data.notified).toBe(false);
    const list = await call('GET', '/api/hq/support/requests');
    expect((await list.json<{ data: unknown[] }>()).data).toHaveLength(1);
  });

  it.each([
    [{ ...REQUEST, kind: 'spam' }, '種類'],
    [{ ...REQUEST, subject: '' }, '件名'],
    [{ ...REQUEST, body: '  ' }, '本文'],
    [{ ...REQUEST, subject: 'あ'.repeat(101) }, '100文字'],
  ])('足りない・長すぎる入力は理由つきで断る: %o', async (body, fragment) => {
    const res = await call('POST', '/api/hq/support/requests', body);
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toContain(fragment);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('画像を添付すると R2 に置き、運営への通知に URL が入る', async () => {
    const res = await call('POST', '/api/hq/support/requests', {
      ...REQUEST,
      attachments: [{ mimeType: 'image/png', data: toB64(PNG) }],
    });
    expect(res.status).toBe(201);
    const data = (await res.json<{ data: { attachments: Array<{ key: string; url: string }> } }>()).data;
    expect(data.attachments).toHaveLength(1);
    expect(data.attachments[0].key.startsWith('support/')).toBe(true);
    expect(r2Store.has(data.attachments[0].key)).toBe(true);
    expect((mail.send.mock.calls[0][1] as { body: string }).body).toContain(data.attachments[0].url);
  });

  it('形式の合わない添付や4枚以上は断る', async () => {
    let res = await call('POST', '/api/hq/support/requests', { ...REQUEST, attachments: [{ mimeType: 'image/gif', data: toB64(PNG) }] });
    expect(res.status).toBe(400);
    res = await call('POST', '/api/hq/support/requests', { ...REQUEST, attachments: [{ mimeType: 'image/jpeg', data: toB64(PNG) }] });
    expect(res.status).toBe(400);
    res = await call('POST', '/api/hq/support/requests', { ...REQUEST, attachments: Array(4).fill({ mimeType: 'image/png', data: toB64(PNG) }) });
    expect(res.status).toBe(400);
    expect(r2Store.size).toBe(0);
  });

  it('別の統括の店舗は関係する店舗に選べない', async () => {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-other', 'channel-x', 'よその店舗', '', '', 1, 'tenant-2')`,
    ).run();
    const res = await call('POST', '/api/hq/support/requests', { ...REQUEST, lineAccountId: 'account-other' });
    expect(res.status).toBe(404);
  });

  it('別の統括の問い合わせは見えない', async () => {
    await call('POST', '/api/hq/support/requests', REQUEST);
    const res = await call('GET', '/api/hq/support/requests', undefined, { staff: staffOf({ id: 'staff-9', tenantId: 'tenant-2' }) });
    expect((await res.json<{ data: unknown[] }>()).data).toEqual([]);
  });

  it('担当者でも送れる', async () => {
    const res = await call('POST', '/api/hq/support/requests', REQUEST, { staff: staffOf({ role: 'staff' }) });
    expect(res.status).toBe(201);
  });

  it('種類の一覧を返す', async () => {
    const res = await call('GET', '/api/hq/support/kinds');
    const data = (await res.json<{ data: Array<{ key: string; label: string }> }>()).data;
    expect(data.map((k) => k.key)).toEqual(['usage', 'bug', 'billing', 'feature', 'other']);
  });
});
