import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantScopeMiddleware } from '../middleware/tenant-scope.js';
import { businessAuditMiddleware } from '../middleware/business-audit.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { contents } from './contents.js';
import { images } from './images.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
vi.mock('../services/file-scan.js', () => ({
  checkMediaGate: async () => ({ allowed: true }),
  getMediaGateInfo: async () => ({ lineAccountId: 'acc-1', sizeBytes: 100, width: 1, height: 1 }),
}));

/**
 * N-202 (#832): 使用先ごとの版固定参照・ライブ参照切替。
 *
 * 本番と同じ順序 auth → tenantScope → businessAudit → feature →
 * images → contents で、実D1・実認証・実走査のまま確かめる。
 * route単体のモック試験では「本文の文字列が本当に書き換わるか」
 * 「走査が両モードを拾うか」は分からないため、この連鎖で試す。
 */

const OWNER_KEY = 'ref-owner-key';
const CONTENTS_KEY = 'ref-contents-key';
const NOPERM_KEY = 'ref-noperm-key';

const V1_KEY = 'media/acc-1/a-v1.png';
const V2_KEY = 'media/acc-1/a-v2.png';
const V3_KEY = 'media/acc-1/a-v3.png';
const WORKER = 'https://api.example.com';
const LIVE_URL = `${WORKER}/media/md-1/content`;
const pinnedUrl = (key: string) => `${WORKER}/images/${key}`;

let testDb: SqliteD1;
let warn: ReturnType<typeof vi.spyOn>;
let enforceD1BindLimit = false;

function insertAccount(id: string, tenantId: string | null): void {
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, `channel-${id}`, id, `token-${id}`, `secret-${id}`, tenantId,
    );
}

function insertStaff(id: string, apiKey: string, role: string, permissionKeys: string): void {
  testDb.raw.prepare(`INSERT INTO staff_members
    (id, name, role, api_key, is_active, tenant_id, permission_keys, access_level)
    VALUES (?, ?, ?, ?, 1, ?, ?, 'full')`).run(
      id, id, role, apiKey, DEFAULT_TENANT_ID, permissionKeys,
    );
}

function insertMedia(id: string, accountId: string, r2Key: string): void {
  testDb.raw.prepare(`INSERT INTO media
    (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, public_url, uploaded_by, created_at)
    VALUES (?, ?, 'image', 'a.png', 'image/png', 100, ?, NULL, 'owner-1', '2026-09-01T00:00:00.000')`)
    .run(id, accountId, r2Key);
}

function insertVersion(mediaId: string, versionNo: number, r2Key: string): void {
  testDb.raw.prepare(`INSERT INTO media_versions
    (id, media_id, version_no, r2_key, mime_type, size_bytes, scan_status, created_at, published_at)
    VALUES (?, ?, ?, ?, 'image/png', 100, 'verified', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`)
    .run(`${mediaId}-v${versionNo}`, mediaId, versionNo, r2Key);
}

/** 新版の追加をそのまま再現する（版行の追加と現行キーの更新）。 */
function addMediaVersion(mediaId: string, versionNo: number, r2Key: string): void {
  insertVersion(mediaId, versionNo, r2Key);
  testDb.raw.prepare(`UPDATE media SET r2_key = ? WHERE id = ?`).run(r2Key, mediaId);
}

function insertTemplate(id: string, accountId: string, imageUrl: string): void {
  testDb.raw.prepare(`INSERT INTO templates
    (id, name, message_type, message_content, line_account_id)
    VALUES (?, ?, 'image', ?, ?)`).run(
      id, id, JSON.stringify({
        type: 'image',
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      }), accountId,
    );
}

function insertBroadcast(id: string, accountId: string, imageUrl: string): void {
  testDb.raw.prepare(`INSERT INTO broadcasts
    (id, title, message_type, message_content, line_account_id)
    VALUES (?, ?, 'image', ?, ?)`).run(
      id, id, JSON.stringify({
        type: 'image',
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      }), accountId,
    );
}

function insertRichMenuPage(pageId: string, accountId: string, r2Key: string): void {
  testDb.raw.prepare(`INSERT INTO rich_menu_groups
    (id, account_id, name, chat_bar_text, size)
    VALUES (?, ?, ?, 'メニュー', 'large')`).run(`g-${pageId}`, accountId, `group-${pageId}`);
  testDb.raw.prepare(`INSERT INTO rich_menu_pages
    (id, group_id, order_index, name, alias_id, image_r2_key)
    VALUES (?, ?, 0, ?, ?, ?)`).run(pageId, `g-${pageId}`, `page-${pageId}`, `alias-${pageId}`, r2Key);
}

function insertMediaFolder(id = 'folder-media'): void {
  testDb.raw.prepare(`INSERT INTO folders(id,kind,name,account_id,created_at,updated_at)
    VALUES (?, 'media', ?, 'acc-1', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`)
    .run(id, id);
}

function templateContent(id: string): string {
  const row = testDb.raw.prepare(
    `SELECT message_content FROM templates WHERE id = ?`,
  ).get(id) as { message_content?: string } | undefined;
  return String(row?.message_content ?? '');
}

function broadcastContent(id: string): string {
  const row = testDb.raw.prepare(
    `SELECT message_content FROM broadcasts WHERE id = ?`,
  ).get(id) as { message_content?: string } | undefined;
  return String(row?.message_content ?? '');
}

function usageRows(mediaId: string): Array<{ ref_kind: string; ref_id: string }> {
  return testDb.raw.prepare(
    `SELECT ref_kind, ref_id FROM media_usages WHERE media_id = ? ORDER BY ref_kind, ref_id`,
  ).all(mediaId) as unknown as Array<{ ref_kind: string; ref_id: string }>;
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.use('*', tenantScopeMiddleware);
  instance.use('/api/*', businessAuditMiddleware);
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.route('/', images);
  instance.route('/', contents);
  return instance;
}

function environment(): Env['Bindings'] {
  const bodies: Record<string, string> = {
    [V1_KEY]: 'PNG-V1',
    [V2_KEY]: 'PNG-V2',
    [V3_KEY]: 'PNG-V3',
  };
  return {
    DB: enforceD1BindLimit ? ({
      prepare(sql: string) {
        const statement = testDb.db.prepare(sql);
        return {
          ...statement,
          bind(...args: unknown[]) {
            if (args.length > 100) throw new Error(`D1 bind limit exceeded: ${args.length} > 100`);
            return statement.bind(...args);
          },
        } as D1PreparedStatement;
      },
      batch: testDb.db.batch.bind(testDb.db),
    } as D1Database) : testDb.db,
    IMAGES: {
      get: async (key: string) =>
        key in bodies
          ? { body: bodies[key], etag: `etag-${key}`, httpMetadata: { contentType: 'image/png' } }
          : null,
      delete: async () => undefined,
    } as unknown as R2Bucket,
    WORKER_URL: WORKER,
    API_KEY: 'env-key-unused',
  } as Env['Bindings'];
}

async function request(path: string, init?: { method?: string; apiKey?: string; body?: unknown }): Promise<Response> {
  return app().request(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.apiKey ? { Authorization: `Bearer ${init.apiKey}` } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  }, environment());
}

function patchUsageReference(
  apiKey: string | undefined,
  usageReference: unknown,
  mediaId = 'md-1',
  accountId = 'acc-1',
  mediaUpdate: { filename?: string; folderId?: string | null } = {},
): Promise<Response> {
  return request(`/api/media/${mediaId}?accountId=${accountId}`, {
    method: 'PATCH',
    apiKey,
    body: { ...mediaUpdate, usageReference },
  });
}

function mediaMetadata(id = 'md-1'): { filename: string; folder_id: string | null } {
  return testDb.raw.prepare(`SELECT filename, folder_id FROM media WHERE id = ?`).get(id) as {
    filename: string;
    folder_id: string | null;
  };
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  testDb = createTestD1();
  enforceD1BindLimit = false;
  insertAccount('acc-1', DEFAULT_TENANT_ID);
  insertAccount('acc-2', 'tenant-B');
  insertStaff('owner-1', OWNER_KEY, 'owner', '[]');
  insertStaff('staff-contents', CONTENTS_KEY, 'staff', '["/contents"]');
  insertStaff('staff-noperm', NOPERM_KEY, 'staff', '[]');
  // 第1版だけの状態から始める。使用先Aは版のURL（固定）、使用先Bは
  // メディアIDのライブ参照URLを本文へ持つ。
  insertMedia('md-1', 'acc-1', V1_KEY);
  insertVersion('md-1', 1, V1_KEY);
  insertTemplate('t-pinned', 'acc-1', pinnedUrl(V1_KEY));
  insertBroadcast('b-live', 'acc-1', LIVE_URL);
});

describe('ライブ参照の公開配信', () => {
  it('認証なしで最新版へ解決され、immutableでは返さない', async () => {
    const res = await request('/media/md-1/content');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PNG-V1');
    const cacheControl = res.headers.get('Cache-Control') ?? '';
    expect(cacheControl).not.toContain('immutable');
  });

  it('新版を追加するとライブ参照は新版へ、固定URLは旧版のまま（対照）', async () => {
    addMediaVersion('md-1', 2, V2_KEY);
    const live = await request('/media/md-1/content');
    expect(await live.text()).toBe('PNG-V2');
    const pinned = await request(`/images/${V1_KEY}`);
    expect(pinned.status).toBe(200);
    expect(await pinned.text()).toBe('PNG-V1');
    // 固定参照の本文も旧版を指したまま。
    expect(templateContent('t-pinned')).toContain(V1_KEY);
  });

  it('存在しないメディアIDは404', async () => {
    const res = await request('/media/md-missing/content');
    expect(res.status).toBe(404);
  });
});

describe('使用先の参照モードと走査', () => {
  it('固定とライブの両モードを走査・削除影響で正しく数える', async () => {
    const res = await request('/api/media/md-1/delete-impact?accountId=acc-1', {
      apiKey: OWNER_KEY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        usageCount: number;
        canDelete: boolean;
        liveUrl: string;
        references: Array<{
          kind: string;
          refKind: string | null;
          refId: string | null;
          reference: { mode: string; versionNo: number | null } | null;
        }>;
        versions: Array<{ versionNo: number; isCurrent: boolean }>;
      };
    };
    expect(body.data.usageCount).toBe(2);
    expect(body.data.canDelete).toBe(false);
    expect(body.data.liveUrl).toBe(LIVE_URL);
    const byKind = Object.fromEntries(
      body.data.references.map((reference) => [reference.refKind, reference]),
    );
    expect(byKind.template?.reference).toEqual({ mode: 'pinned', versionNo: 1 });
    expect(byKind.broadcast?.reference).toEqual({ mode: 'live', versionNo: null });
    expect(byKind.template?.refId).toBe('t-pinned');
    expect(byKind.broadcast?.refId).toBe('b-live');
    expect(body.data.versions.map((version) => version.versionNo)).toEqual([1]);
    // 走査の記録にも両モードが残る。
    expect(usageRows('md-1')).toEqual([
      { ref_kind: 'broadcast', ref_id: 'b-live' },
      { ref_kind: 'template', ref_id: 't-pinned' },
    ]);
  });

  it('旧版を指す固定参照も新版追加後に使用先として数えられる', async () => {
    addMediaVersion('md-1', 2, V2_KEY);
    const res = await request('/api/media/md-1/delete-impact?accountId=acc-1', {
      apiKey: OWNER_KEY,
    });
    const body = (await res.json()) as {
      data: { usageCount: number; references: Array<{ refKind: string; reference: { mode: string; versionNo: number | null } | null }> };
    };
    // 旧版(v1)を指す固定参照は消えず pinned v1 のまま見える。
    expect(body.data.usageCount).toBe(2);
    const pinned = body.data.references.find((reference) => reference.refKind === 'template');
    expect(pinned?.reference).toEqual({ mode: 'pinned', versionNo: 1 });
  });
});

describe('使用先ごとの参照切替', () => {
  it('固定参照をライブ参照へ切り替えると当該使用先だけが変わる（逆変異）', async () => {
    insertTemplate('t-keep', 'acc-1', pinnedUrl(V1_KEY));
    const before = templateContent('t-keep');
    const res = await patchUsageReference(OWNER_KEY, {
      refKind: 'template',
      refId: 't-pinned',
      mode: 'live',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { usageReference: { mode: string; changed: boolean } } };
    expect(body.data.usageReference.mode).toBe('live');
    expect(body.data.usageReference.changed).toBe(true);
    // 対象の本文だけがライブ参照URLへ書き換わる。
    expect(templateContent('t-pinned')).toContain('/media/md-1/content');
    expect(templateContent('t-pinned')).not.toContain(V1_KEY);
    // 同じメディアを固定参照する別の使用先は1文字も変わらない。
    expect(templateContent('t-keep')).toBe(before);
    expect(broadcastContent('b-live')).toContain('/media/md-1/content');
    // 走査後も両方の使用先が記録される。
    expect(usageRows('md-1')).toEqual([
      { ref_kind: 'broadcast', ref_id: 'b-live' },
      { ref_kind: 'template', ref_id: 't-keep' },
      { ref_kind: 'template', ref_id: 't-pinned' },
    ]);
  });

  it('ライブ参照を指定版へ固定でき、旧版を指す別使用先は変わらない', async () => {
    addMediaVersion('md-1', 2, V2_KEY);
    const res = await patchUsageReference(OWNER_KEY, {
      refKind: 'broadcast',
      refId: 'b-live',
      mode: 'pinned',
      versionNo: 2,
    });
    expect(res.status).toBe(200);
    expect(broadcastContent('b-live')).toContain(pinnedUrl(V2_KEY));
    expect(broadcastContent('b-live')).not.toContain('/media/md-1/content');
    // v1を指す固定参照はそのまま旧版。
    expect(templateContent('t-pinned')).toContain(V1_KEY);
  });

  it('固定版を別の版へ切り替えると対象だけが新版へ変わる', async () => {
    addMediaVersion('md-1', 2, V2_KEY);
    const res = await patchUsageReference(OWNER_KEY, {
      refKind: 'template',
      refId: 't-pinned',
      mode: 'pinned',
      versionNo: 2,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { usageReference: { mode: string; versionNo: number | null } } };
    expect(body.data.usageReference).toMatchObject({ mode: 'pinned', versionNo: 2 });
    expect(templateContent('t-pinned')).toContain(V2_KEY);
    expect(templateContent('t-pinned')).not.toContain(V1_KEY);
    expect(broadcastContent('b-live')).toContain('/media/md-1/content');
  });

  it('別アカウントの使用先は切り替え対象にできず、本文も変わらない（逆変異）', async () => {
    insertAccount('acc-3', DEFAULT_TENANT_ID);
    insertTemplate('t-other', 'acc-3', pinnedUrl(V1_KEY));
    const before = templateContent('t-other');
    const res = await patchUsageReference(OWNER_KEY, {
      refKind: 'template',
      refId: 't-other',
      mode: 'live',
    });
    expect(res.status).toBe(404);
    expect(templateContent('t-other')).toBe(before);
  });

  it('リッチメニューはR2キーで渡す列のためライブ参照を選べない', async () => {
    insertRichMenuPage('p-1', 'acc-1', V1_KEY);
    const res = await patchUsageReference(OWNER_KEY, {
      refKind: 'rich_menu',
      refId: 'p-1',
      mode: 'live',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('media_reference_unsupported');
    // 逆に固定版への切替は通る。
    addMediaVersion('md-1', 2, V2_KEY);
    const pinned = await patchUsageReference(OWNER_KEY, {
      refKind: 'rich_menu',
      refId: 'p-1',
      mode: 'pinned',
      versionNo: 2,
    });
    expect(pinned.status).toBe(200);
    const row = testDb.raw.prepare(
      `SELECT image_r2_key FROM rich_menu_pages WHERE id = 'p-1'`,
    ).get() as { image_r2_key: string };
    expect(row.image_r2_key).toBe(V2_KEY);
  });

  it('存在しない版への固定は404、指定のない切替は400', async () => {
    const missing = await patchUsageReference(OWNER_KEY, {
      refKind: 'template',
      refId: 't-pinned',
      mode: 'pinned',
      versionNo: 9,
    });
    expect(missing.status).toBe(404);
    const bad = await patchUsageReference(OWNER_KEY, {
      refKind: 'template',
      refId: 't-pinned',
      mode: 'unknown-mode',
    });
    expect(bad.status).toBe(400);
  });

  it('参照切替が失敗したとき、同じPATCHの名前・フォルダも一切保存しない', async () => {
    insertMediaFolder();
    const before = mediaMetadata();
    const update = { filename: 'renamed.png', folderId: 'folder-media' };
    const unchanged = () => expect(mediaMetadata()).toEqual(before);

    const invalid = await patchUsageReference(OWNER_KEY, {
      refKind: 'unknown', refId: 'missing', mode: 'live',
    }, 'md-1', 'acc-1', update);
    expect(invalid.status).toBe(400);
    unchanged();

    const missingVersion = await patchUsageReference(OWNER_KEY, {
      refKind: 'template', refId: 't-pinned', mode: 'pinned', versionNo: 99,
    }, 'md-1', 'acc-1', update);
    expect(missingVersion.status).toBe(404);
    unchanged();

    insertTemplate('t-stale', 'acc-1', 'https://example.com/not-this-media.png');
    const stale = await patchUsageReference(OWNER_KEY, {
      refKind: 'template', refId: 't-stale', mode: 'live',
    }, 'md-1', 'acc-1', update);
    expect(stale.status).toBe(409);
    unchanged();

    insertRichMenuPage('p-unsupported', 'acc-1', V1_KEY);
    const unsupported = await patchUsageReference(OWNER_KEY, {
      refKind: 'rich_menu', refId: 'p-unsupported', mode: 'live',
    }, 'md-1', 'acc-1', update);
    expect(unsupported.status).toBe(409);
    unchanged();

    testDb.raw.prepare(`UPDATE broadcasts SET account_ids = '["acc-1","acc-3"]' WHERE id = 'b-live'`).run();
    const shared = await patchUsageReference(OWNER_KEY, {
      refKind: 'broadcast', refId: 'b-live', mode: 'pinned', versionNo: 1,
    }, 'md-1', 'acc-1', update);
    expect(shared.status).toBe(409);
    unchanged();
  });

  it('17版以上が混在する使用先もD1の100 bind以内でライブ参照へ切り替える', async () => {
    const keys = [V1_KEY];
    for (let versionNo = 2; versionNo <= 17; versionNo += 1) {
      const key = `media/acc-1/a-v${versionNo}.png`;
      keys.push(key);
      addMediaVersion('md-1', versionNo, key);
    }
    testDb.raw.prepare(`UPDATE broadcasts SET message_content = ? WHERE id = 'b-live'`)
      .run(JSON.stringify({ images: keys.map((key) => pinnedUrl(key)) }));
    enforceD1BindLimit = true;
    const res = await patchUsageReference(OWNER_KEY, {
      refKind: 'broadcast', refId: 'b-live', mode: 'live',
    });
    expect(res.status).toBe(200);
    expect(broadcastContent('b-live')).toContain('/media/md-1/content');
    for (const key of keys) expect(broadcastContent('b-live')).not.toContain(key);
  });

  it('使用中のメディアは削除できず、外すと削除できる（既存の削除事前確認）', async () => {
    const blocked = await request('/api/media/md-1?accountId=acc-1', {
      method: 'DELETE',
      apiKey: OWNER_KEY,
    });
    expect(blocked.status).toBe(409);
    // 両使用先を外す（本文から参照を消す）と削除できる。
    testDb.raw.prepare(`UPDATE templates SET message_content = '{}' WHERE id = 't-pinned'`).run();
    testDb.raw.prepare(`UPDATE broadcasts SET message_content = '{}' WHERE id = 'b-live'`).run();
    // 走査時刻はミリ秒精度。同一ミリ秒内に再削除すると古い行が
    // 「今回の走査結果」と区別できず残るため、時刻が進むのを待つ。
    await new Promise((resolve) => setTimeout(resolve, 5));
    const freed = await request('/api/media/md-1?accountId=acc-1', {
      method: 'DELETE',
      apiKey: OWNER_KEY,
    });
    expect(freed.status).toBe(200);
  });
});

describe('認証と権限', () => {
  const switchBody = {
    refKind: 'template',
    refId: 't-pinned',
    mode: 'live',
  };

  it('認証なしは401', async () => {
    const res = await patchUsageReference(undefined, switchBody);
    expect(res.status).toBe(401);
    expect(templateContent('t-pinned')).toContain(V1_KEY);
  });

  it('staffは役割不足で403', async () => {
    const res = await patchUsageReference(CONTENTS_KEY, switchBody);
    expect(res.status).toBe(403);
    expect(templateContent('t-pinned')).toContain(V1_KEY);
  });

  it('権限のないstaffは境界で403', async () => {
    const res = await patchUsageReference(NOPERM_KEY, switchBody);
    expect(res.status).toBe(403);
  });

  it('別統括のアカウント指定は境界で403', async () => {
    const res = await patchUsageReference(OWNER_KEY, switchBody, 'md-1', 'acc-2');
    expect(res.status).toBe(403);
  });
});
