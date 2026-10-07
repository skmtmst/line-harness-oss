import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getBroadcastMessageAsset } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn().mockResolvedValue(true),
  getVisibleLineAccountScope: vi.fn().mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: true,
  }),
}));

vi.mock('../services/broadcast-media-storage.js', () => ({
  storeBroadcastMedia: vi.fn(),
}));
vi.mock('../services/file-scan.js', () => ({
  builtinFileScan: vi.fn(() => ({ verdict: 'clean' })),
  checkKeyGate: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('./file-scan.js', () => ({
  ensureFileScanForUpload: vi.fn(async () => undefined),
}));

import { broadcastMessageAssets } from './broadcast-message-assets.js';

function app() {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  hono.route('/', broadcastMessageAssets);
  return hono;
}

let store: SqliteD1;
let bindings: Env['Bindings'];

const COUPON = { startsAt:'2026-01-01T00:00',endsAt:'2027-01-01T00:00', title: '見本クーポン', description: '10%お得', actionUrl: 'https://example.com/' };

beforeEach(() => {
  store = createTestD1();
  bindings = { DB: store.db } as Env['Bindings'];
  store.raw.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES ('account-1', 'channel-account-1', 'A1', 'token', 'secret', 1, 'tenant-1'),
             ('account-2', 'channel-account-2', 'A2', 'token', 'secret', 1, 'tenant-1');
    INSERT INTO broadcast_asset_folders (id, line_account_id, name, display_order, created_at, updated_at)
      VALUES ('folder-1', 'account-1', '素材置き場', 0, '2026-10-02T00:00:00+09:00', '2026-10-02T00:00:00+09:00'),
             ('folder-out', 'account-2', '別', 0, '2026-10-02T00:00:00+09:00', '2026-10-02T00:00:00+09:00');`);
});

async function createAsset(body: Record<string, unknown>) {
  return app().request('/api/broadcast-message-assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, bindings);
}

describe('F4 素材の公開・下書き・版', () => {
  it('新規は未公開の下書きで始まる', async () => {
    const res = await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '新しい素材', payload: COUPON, folderId: 'folder-1',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { status: string; publishedVersion: number; draftRevision: number; hasDraft: boolean; folderId: string } };
    expect(body.data.status).toBe('draft');
    expect(body.data.publishedVersion).toBe(0);
    expect(body.data.draftRevision).toBe(1);
    expect(body.data.hasDraft).toBe(true);
    expect(body.data.folderId).toBe('folder-1');
  });

  it('PUTは公開版を変えず下書きだけ進める（旧callerは下書きを読む）', async () => {
    const created = await (await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payload: COUPON,
    })).json() as { data: { id: string } };
    const id = created.data.id;
    const firstPublish = await app().request(`/api/broadcast-message-assets/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-key-0001' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 1 }),
    }, bindings);
    expect(firstPublish.status).toBe(200);
    const putRes = await app().request(`/api/broadcast-message-assets/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '素材', payload: { ...COUPON, title: '編集中' } }),
    }, bindings);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { data: { payload: { title: string }; publishedPayload: { title: string }; publishedVersion: number; hasDraft: boolean } };
    expect(putBody.data.payload.title).toBe('編集中');
    expect(putBody.data.publishedPayload.title).toBe('見本クーポン');
    expect(putBody.data.publishedVersion).toBe(1);
    expect(putBody.data.hasDraft).toBe(true);
  });

  it('同じ版の2公開は勝者1・敗者409、同じ確認キーの再送は同じ結果', async () => {
    const created = await (await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payload: COUPON,
    })).json() as { data: { id: string } };
    const id = created.data.id;
    const first = await app().request(`/api/broadcast-message-assets/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-key-0002' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 1 }),
    }, bindings);
    expect(first.status).toBe(200);
    const replay = await app().request(`/api/broadcast-message-assets/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-key-0002' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 1 }),
    }, bindings);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { data: { replayed: boolean } }).data.replayed).toBe(true);
    const loser = await app().request(`/api/broadcast-message-assets/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-key-0003' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 1 }),
    }, bindings);
    expect(loser.status).toBe(409);
  });

  it('版履歴は新しい版から返す', async () => {
    const created = await (await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payload: COUPON,
    })).json() as { data: { id: string } };
    const id = created.data.id;
    await app().request(`/api/broadcast-message-assets/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'publish-key-0004' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 1 }),
    }, bindings);
    const res = await app().request(`/api/broadcast-message-assets/${id}/versions`, {}, bindings);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ versionNumber: number }> };
    expect(body.data.map((v) => v.versionNumber)).toEqual([1]);
  });

  it('外アカウント・不明folderを拒否する', async () => {
    const badFolder = await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payload: COUPON, folderId: 'folder-out',
    });
    expect(badFolder.status).toBe(422);
    const missing = await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payload: COUPON, folderId: 'no-such-folder',
    });
    expect(missing.status).toBe(422);
  });

  it('置き場の一覧と作成ができる', async () => {
    const created = await app().request('/api/broadcast-message-assets/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', name: '新しい置き場' }),
    }, bindings);
    expect(created.status).toBe(201);
    const list = await app().request('/api/broadcast-message-assets/folders?lineAccountId=account-1', {}, bindings);
    expect(list.status).toBe(200);
    const body = await list.json() as { data: Array<{ id: string; name: string; lineAccountId: string }> };
    expect(body.data.map((f) => f.name)).toContain('新しい置き場');
    expect(body.data.map((f) => f.name)).toContain('素材置き場');
  });

  it('PUTの古い期待版は409で、名前・置き場・本文すべて不変', async () => {
    const created = await (await createAsset({
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payload: COUPON, folderId: 'folder-1',
    })).json() as { data: { id: string } };
    const id = created.data.id;
    const winner = await app().request(`/api/broadcast-message-assets/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '勝者', payload: { ...COUPON, title: '勝者案' } }),
    }, bindings);
    expect(winner.status).toBe(200);
    const stale = await app().request(`/api/broadcast-message-assets/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '負け', payload: { ...COUPON, title: '負け案' }, folderId: null,
        expectedVersion: 0, expectedDraftRevision: 1,
      }),
    }, bindings);
    expect(stale.status).toBe(409);
    const row = await getBroadcastMessageAsset(store.db, id);
    expect(row!.name).toBe('勝者');
    expect(row!.folder_id).toBe('folder-1');
    expect(JSON.parse(row!.draft_payload_json!)).toEqual({ ...COUPON, title: '勝者案' });
    expect(row!.payload_json).toContain('見本クーポン');
  });

  it('一覧とcountsは同じ絞り込み母集団になる', async () => {
    await createAsset({ lineAccountId: 'account-1', kind: 'coupon', name: '下書き', payload: COUPON });
    const list = await app().request('/api/broadcast-message-assets?status=draft', {}, bindings);
    const listBody = await list.json() as { data: Array<unknown> };
    const counts = await app().request('/api/broadcast-message-assets/counts?status=draft', {}, bindings);
    const countsBody = await counts.json() as { data: Record<string, number> };
    const total = Object.values(countsBody.data).reduce((a, b) => a + b, 0);
    expect(total).toBe(listBody.data.length);
  });
});
