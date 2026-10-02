import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  createBroadcastMessageAsset,
  getBroadcastMessageAsset,
  listBroadcastMessageAssetVersions,
  publishBroadcastMessageAsset,
  saveBroadcastMessageAssetDraft,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn().mockResolvedValue(true),
  getVisibleLineAccountScope: vi.fn().mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: true,
  }),
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

const COUPON_A = { title: 'A案', description: '10%お得', actionUrl: 'https://example.com/a' };
const COUPON_B = { title: 'B案', description: '20%お得', actionUrl: 'https://example.com/b' };

async function keyRows(assetId: string) {
  const res = await store.db.prepare(
    'SELECT idempotency_key AS key FROM broadcast_asset_publish_keys WHERE asset_id = ? ORDER BY idempotency_key',
  ).bind(assetId).all<{ key: string }>();
  return (res.results ?? []).map((r) => r.key);
}

beforeEach(() => {
  store = createTestD1();
  bindings = { DB: store.db } as Env['Bindings'];
});

describe('F4公開の交錯（逐次awaitではなくCASの間に別保存を挟む）', () => {
  it('負けた側は409で、versionとreceiptに副作用を残さない', async () => {
    const created = await createBroadcastMessageAsset(store.db, {
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payloadJson: JSON.stringify(COUPON_A),
    });
    const id = created!.id;
    // 先に勝者が確定させる。
    await publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'winner-key',
    });
    // 古い期待のまま再送する負け側（別キー）。逐次ではなくCAS敗北の経路。
    await expect(publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'loser-key',
    })).rejects.toThrow('ASSET_VERSION_CONFLICT');
    expect(await keyRows(id)).toEqual(['winner-key']);
    expect((await listBroadcastMessageAssetVersions(store.db, id)).length).toBe(1);
  });

  it('CASの読取と書込の間に別保存が挟まっても、負け側の自keyを成功にしない', async () => {
    const created = await createBroadcastMessageAsset(store.db, {
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payloadJson: JSON.stringify(COUPON_A),
    });
    const id = created!.id;
    const rawBatch = store.db.batch.bind(store.db);
    const racedDb = {
      ...store.db,
      batch: async (statements: D1PreparedStatement[]) => {
        // CAS読取の直後に競合者が勝つ交錯を再現する。
        await publishBroadcastMessageAsset(store.db, id, {
          expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'rival-key',
        });
        return rawBatch(statements);
      },
    } as D1Database;
    await expect(publishBroadcastMessageAsset(racedDb, id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'mine-key',
    })).rejects.toThrow('ASSET_VERSION_CONFLICT');
    // 負け側の自keyを拾って成功にしてはならない。副作用は勝者の分だけ。
    expect(await keyRows(id)).toEqual(['rival-key']);
    expect((await listBroadcastMessageAssetVersions(store.db, id)).length).toBe(1);
  });

  it('当時の成功結果を返す（後に版が進んでも旧結果）', async () => {
    const created = await createBroadcastMessageAsset(store.db, {
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payloadJson: JSON.stringify(COUPON_A),
    });
    const id = created!.id;
    await publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'key-v1',
    });
    await saveBroadcastMessageAssetDraft(store.db, id, { payloadJson: JSON.stringify(COUPON_B) });
    await publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: 1, expectedDraftRevision: 1, idempotencyKey: 'key-v2',
    });
    const replay = await publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'key-v1',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.recordedVersion).toBe(1);
    expect(JSON.parse(replay.recordedPayloadJson!)).toEqual(COUPON_A);
  });

  it('同じ確認キーで別内容は409', async () => {
    const created = await createBroadcastMessageAsset(store.db, {
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payloadJson: JSON.stringify(COUPON_A),
    });
    const id = created!.id;
    await publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: 0, expectedDraftRevision: 1, idempotencyKey: 'same-key',
    });
    await saveBroadcastMessageAssetDraft(store.db, id, { payloadJson: JSON.stringify(COUPON_B) });
    const current = await getBroadcastMessageAsset(store.db, id);
    await expect(publishBroadcastMessageAsset(store.db, id, {
      expectedVersion: Number(current!.published_version),
      expectedDraftRevision: Number(current!.draft_revision),
      idempotencyKey: 'same-key',
    })).rejects.toThrow('ASSET_PUBLISH_KEY_CONFLICT');
  });

  it('下書き保存のCAS敗北は名前・置き場・本文すべて不変', async () => {
    const created = await createBroadcastMessageAsset(store.db, {
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payloadJson: JSON.stringify(COUPON_A),
    });
    const id = created!.id;
    await saveBroadcastMessageAssetDraft(store.db, id, {
      name: '勝者', payloadJson: JSON.stringify(COUPON_B),
    });
    await expect(saveBroadcastMessageAssetDraft(store.db, id, {
      name: '負け', folderId: 'folder-x', payloadJson: JSON.stringify(COUPON_A),
      expectedVersion: 0, expectedDraftRevision: 1,
    })).rejects.toThrow('ASSET_DRAFT_CONFLICT');
    const row = await getBroadcastMessageAsset(store.db, id);
    expect(row!.name).toBe('勝者');
    expect(row!.folder_id).toBeNull();
    expect(JSON.parse(row!.draft_payload_json!)).toEqual(COUPON_B);
  });

  it('越境の公開は404で、versionとreceiptに触らない', async () => {
    const created = await createBroadcastMessageAsset(store.db, {
      lineAccountId: 'account-1', kind: 'coupon', name: '素材', payloadJson: JSON.stringify(COUPON_A),
    });
    const id = created!.id;
    const access = await import('../services/account-access.js');
    vi.mocked(access.canAccessAllLineAccounts).mockResolvedValueOnce(false);
    const res = await app().request(`/api/broadcast-message-assets/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'cross-key-0001' },
      body: JSON.stringify({ expectedVersion: 0, expectedDraftRevision: 1 }),
    }, bindings);
    expect(res.status).toBe(404);
    expect(await keyRows(id)).toEqual([]);
    expect((await listBroadcastMessageAssetVersions(store.db, id)).length).toBe(0);
  });
});
