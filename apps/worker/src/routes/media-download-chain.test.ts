import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * #637 差し戻し対応。本番と同じ順序
 * auth → tenantScope → businessAudit → feature → contents で、
 * 越境拒否の正規監査 media.download/denied が1件だけ残ることを確かめる。
 *
 * route単体の試験は middleware を付けずに呼ぶため、境界で止まる拒否の
 * 監査は見えない。境界自身が書くことは、この連鎖でしか確かめられない。
 */

const CONTENTS_KEY = 'chain-contents-key';
const NOPERM_KEY = 'chain-noperm-key';

let testDb: SqliteD1;
let warn: ReturnType<typeof vi.spyOn>;

function insertAccount(id: string, tenantId: string | null): void {
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, `channel-${id}`, id, `token-${id}`, `secret-${id}`, tenantId,
    );
}

function insertStaff(id: string, apiKey: string, permissionKeys: string): void {
  testDb.raw.prepare(`INSERT INTO staff_members
    (id, name, role, api_key, is_active, tenant_id, permission_keys, access_level)
    VALUES (?, ?, 'staff', ?, 1, ?, ?, 'full')`).run(
      id, id, apiKey, DEFAULT_TENANT_ID, permissionKeys,
    );
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.use('*', tenantScopeMiddleware);
  instance.use('/api/*', businessAuditMiddleware);
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.route('/', contents);
  return instance;
}

function environment(): Env['Bindings'] {
  return {
    DB: testDb.db,
    IMAGES: {
      get: async (key: string) =>
        key === 'media/xxx.png'
          ? { body: 'PNGDATA', etag: 'etag-1', httpMetadata: { contentType: 'image/png' } }
          : null,
    } as unknown as R2Bucket,
    WORKER_URL: 'https://api.example.com',
    API_KEY: 'env-key-unused',
  } as Env['Bindings'];
}

async function download(path: string, apiKey?: string): Promise<Response> {
  return app().request(path, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  }, environment());
}

type AuditRow = {
  action: string;
  result: string;
  line_account_id: string | null;
  target_kind: string | null;
  target_id: string | null;
};

function mediaDownloadAudits(): AuditRow[] {
  return testDb.raw.prepare(
    `SELECT action, result, line_account_id, target_kind, target_id
       FROM audit_events WHERE action = 'media.download' ORDER BY created_at`,
  ).all() as unknown as AuditRow[];
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  testDb = createTestD1();
  insertAccount('acc-1', DEFAULT_TENANT_ID);
  insertAccount('acc-2', 'tenant-B');
  insertStaff('staff-contents', CONTENTS_KEY, '["/contents"]');
  insertStaff('staff-noperm', NOPERM_KEY, '[]');
  testDb.raw.prepare(`INSERT INTO media
    (id, line_account_id, kind, filename, mime_type, size_bytes, r2_key, public_url, uploaded_by)
    VALUES ('md-1', 'acc-1', 'image', 'a.png', 'image/png', 100, 'media/xxx.png', NULL, 'staff-contents')`).run();
});

afterEach(() => {
  warn.mockRestore();
});

describe('メディアダウンロードの本番連鎖', () => {
  it('権限と範囲のある利用者は受け取れて成功が1件残る', async () => {
    const res = await download('/api/media/md-1/download?accountId=acc-1', CONTENTS_KEY);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PNGDATA');
    expect(mediaDownloadAudits()).toEqual([{
      action: 'media.download',
      result: 'success',
      line_account_id: 'acc-1',
      target_kind: 'media',
      target_id: 'md-1',
    }]);
  });

  it('別統括への越境は境界で止まり拒否が1件だけ残る', async () => {
    const res = await download('/api/media/md-1/download?accountId=acc-2', CONTENTS_KEY);
    expect(res.status).toBe(403);
    // routeまで届かないため、境界自身の記録が正規の1件になる。
    expect(mediaDownloadAudits()).toEqual([{
      action: 'media.download',
      result: 'denied',
      line_account_id: 'acc-2',
      target_kind: 'media',
      target_id: 'md-1',
    }]);
  });

  it('contents権限のない担当者は認証で止まり記録は残らない', async () => {
    const res = await download('/api/media/md-1/download?accountId=acc-1', NOPERM_KEY);
    expect(res.status).toBe(403);
    expect(mediaDownloadAudits()).toEqual([]);
  });

  it('認証なしは401で止まり記録は残らない', async () => {
    const res = await download('/api/media/md-1/download?accountId=acc-1');
    expect(res.status).toBe(401);
    expect(mediaDownloadAudits()).toEqual([]);
  });

  it('表示用content口も同じ認可で通る', async () => {
    const ok = await download('/api/media/md-1/content?accountId=acc-1', CONTENTS_KEY);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Disposition')).toContain('inline');
    const denied = await download('/api/media/md-1/content?accountId=acc-2', CONTENTS_KEY);
    expect(denied.status).toBe(403);
  });
});

describe('配信用の公開面の分離', () => {
  it('配信本文に埋めた公開URLは認証なしで届く（意図した公開）', async () => {
    const instance = new Hono<Env>();
    instance.route('/', images);
    const res = await instance.request('/images/media/xxx.png', {}, environment());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PNGDATA');
  });

  it('公開URLに秘密値は載らない', async () => {
    const res = await download('/api/media?accountId=acc-1', CONTENTS_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ url: string }> } };
    expect(body.data.items[0]?.url).toBe('https://api.example.com/images/media/xxx.png');
  });
});
