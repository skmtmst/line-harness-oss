import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { fileScan } from './file-scan.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * 危険なファイルの検査の管理口。
 * 権限（owner/admin だけの一覧・消去・戻し）、範囲（別アカウントは404）、
 * 失敗（pending は通さない）、二重実行（再試行の連打は1行のまま）を見る。
 */

let testDb: SqliteD1;

function insertAccount(id: string, tenantId: string = DEFAULT_TENANT_ID): void {
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, `channel-${id}`, id, `token-${id}`, `secret-${id}`, tenantId,
    );
}

function insertStaff(id: string, role: string): void {
  testDb.raw.prepare(`INSERT INTO staff_members
    (id, name, role, api_key, is_active, tenant_id, permission_keys, access_level)
    VALUES (?, ?, ?, ?, 1, ?, '[]', 'full')`).run(
      id, id, role, `key-${id}`, DEFAULT_TENANT_ID,
    );
}

function insertScan(overrides: Record<string, unknown> = {}) {
  const row = {
    id: `scan-${Math.random().toString(36).slice(2)}`,
    line_account_id: 'acc-1',
    subject_kind: 'media',
    subject_id: 'md-1',
    media_id: 'md-1',
    filename: 'a.png',
    mime_type: 'image/png',
    size_bytes: 100,
    status: 'quarantined',
    reason_code: 'trailing_data',
    reason_detail: '画像の後ろに別のデータがあります',
    attempts: 0,
    next_retry_at: null,
    scanned_at: '2026-09-25T10:00:00+09:00',
    quarantined_at: '2026-09-25T10:00:00+09:00',
    released_at: null,
    release_reason: null,
    released_by: null,
    created_at: '2026-09-25T10:00:00+09:00',
    updated_at: '2026-09-25T10:00:00+09:00',
    ...overrides,
  };
  testDb.raw.prepare(`INSERT INTO media_file_scans
    (id, line_account_id, subject_kind, subject_id, media_id, filename, mime_type,
     size_bytes, status, reason_code, reason_detail, attempts, next_retry_at,
     scanned_at, quarantined_at, released_at, release_reason, released_by,
     created_at, updated_at)
    VALUES (@id, @line_account_id, @subject_kind, @subject_id, @media_id, @filename,
     @mime_type, @size_bytes, @status, @reason_code, @reason_detail, @attempts,
     @next_retry_at, @scanned_at, @quarantined_at, @released_at, @release_reason,
     @released_by, @created_at, @updated_at)`).run(row);
  return row;
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', authMiddleware);
  instance.route('/', fileScan);
  return instance;
}

function environment(): Env['Bindings'] {
  return {
    DB: testDb.db,
    IMAGES: { delete: async () => undefined } as unknown as R2Bucket,
    WORKER_URL: 'https://api.example.com',
    API_KEY: 'env-key-unused',
  } as Env['Bindings'];
}

async function call(path: string, staffId: string, init?: RequestInit): Promise<Response> {
  return app().request(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer key-${staffId}` },
  }, environment());
}

function get(path: string, staffId: string): Promise<Response> {
  return call(path, staffId, { method: 'GET' });
}

function putConfig(path: string, staffId: string, body: unknown): Promise<Response> {
  return call(path, staffId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function post(path: string, staffId: string, body: unknown): Promise<Response> {
  return call(path, staffId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  testDb = createTestD1();
  insertAccount('acc-1');
  insertAccount('acc-2', 'tenant-B');
  insertStaff('owner-1', 'owner');
  insertStaff('admin-1', 'admin');
  // staff は登録メディア（/contents）の鍵を持つ。検査の状態確認に要る。
  testDb.raw.prepare(`INSERT INTO staff_members
    (id, name, role, api_key, is_active, tenant_id, permission_keys, access_level)
    VALUES ('staff-1', 'staff-1', 'staff', 'key-staff-1', 1, ?, '["/contents"]', 'full')`).run(
      DEFAULT_TENANT_ID,
    );
});

describe('ファイル検査の一覧', () => {
  it('owner は見られるが staff は見られない', async () => {
    insertScan();
    const ownerRes = await get('/api/file-scans?accountId=acc-1', 'owner-1');
    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json() as { data: { items: unknown[] } };
    expect(ownerBody.data.items).toHaveLength(1);

    const staffRes = await get('/api/file-scans?accountId=acc-1', 'staff-1');
    expect(staffRes.status).toBe(403);
  });

  it('別アカウントの範囲は404にする', async () => {
    insertScan({ line_account_id: 'acc-1' });
    const res = await get('/api/file-scans?accountId=acc-2', 'owner-1');
    expect(res.status).toBe(404);
  });

  it('staff は自分の上げた分の状態は見られる', async () => {
    const scan = insertScan({ status: 'pending', reason_code: null, reason_detail: null });
    const res = await get(
      `/api/file-scans/by-subject?kind=media&id=${scan.subject_id}&accountId=acc-1`, 'staff-1',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { scan: { status: string } | null } };
    expect(body.data.scan?.status).toBe('pending');
  });
});

describe('誤りなので戻す', () => {
  it('理由がなければ戻せない', async () => {
    const scan = insertScan();
    const res = await post(`/api/file-scans/${scan.id}/release`, 'owner-1', { accountId: 'acc-1', reason: '' });
    expect(res.status).toBe(400);
  });

  it('しまったものだけ理由付きで戻せる', async () => {
    const scan = insertScan();
    const res = await post(`/api/file-scans/${scan.id}/release`, 'admin-1', {
      accountId: 'acc-1', reason: '社内の画像と確認できたため',
    });
    expect(res.status).toBe(200);
    const row = testDb.raw.prepare(`SELECT status, release_reason FROM media_file_scans WHERE id = ?`)
      .get(scan.id) as { status: string; release_reason: string };
    expect(row.status).toBe('clean');
    expect(row.release_reason).toBe('社内の画像と確認できたため');
  });

  it('しまっていないものは戻せない', async () => {
    const scan = insertScan({ status: 'rejected', reason_code: 'too_large' });
    const res = await post(`/api/file-scans/${scan.id}/release`, 'owner-1', {
      accountId: 'acc-1', reason: '理由',
    });
    expect(res.status).toBe(409);
  });
});

describe('消す', () => {
  it('しまったものは消せる', async () => {
    const scan = insertScan();
    const res = await call(`/api/file-scans/${scan.id}?accountId=acc-1`, 'owner-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const row = testDb.raw.prepare(`SELECT id FROM media_file_scans WHERE id = ?`).get(scan.id);
    expect(row).toBeUndefined();
  });

  it('使えるものは消せない', async () => {
    const scan = insertScan({ status: 'clean', reason_code: null });
    const res = await call(`/api/file-scans/${scan.id}?accountId=acc-1`, 'owner-1', { method: 'DELETE' });
    expect(res.status).toBe(409);
  });
});

describe('再試行', () => {
  it('連打しても行は1つのまま pending に戻る', async () => {
    const scan = insertScan({ status: 'rejected', reason_code: 'unreadable' });
    for (let i = 0; i < 2; i += 1) {
      const res = await post(`/api/file-scans/${scan.id}/retry`, 'owner-1', { accountId: 'acc-1' });
      expect(res.status).toBe(200);
    }
    const rows = testDb.raw.prepare(`SELECT status FROM media_file_scans WHERE id = ?`).all(scan.id);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { status: string }).status).toBe('pending');
  });
});

describe('止まっている時の表示', () => {
  it('30分以上 pending のままなら止まっていると出す', async () => {
    insertScan({
      status: 'pending', reason_code: null, reason_detail: null, quarantined_at: null,
      created_at: '2026-09-25T08:00:00+09:00', updated_at: '2026-09-25T08:00:00+09:00',
    });
    const res = await get('/api/file-scans/health?accountId=acc-1', 'staff-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { stopped: boolean; pendingCount: number } };
    expect(body.data.stopped).toBe(true);
    expect(body.data.pendingCount).toBe(1);
  });

  it('何も止まっていなければ止まっていないと出す', async () => {
    const res = await get('/api/file-scans/health?accountId=acc-1', 'staff-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { stopped: boolean } };
    expect(body.data.stopped).toBe(false);
  });
});

describe('外の検査の設定', () => {
  it('http の宛先は断る', async () => {
    const res = await putConfig('/api/file-scans/config', 'owner-1', {
      accountId: 'acc-1',
      externalProvider: 'example',
      externalEndpointUrl: 'http://example.com/scan',
    });
    expect(res.status).toBe(400);
  });

  it('鍵は返さず名前だけ返す', async () => {
    const put = await putConfig('/api/file-scans/config', 'owner-1', {
      accountId: 'acc-1',
      externalProvider: 'example',
      externalEndpointUrl: 'https://example.com/scan',
      externalSecretRef: 'FILE_SCAN_API_KEY',
    });
    expect(put.status).toBe(200);
    const res = await get('/api/file-scans/config?accountId=acc-1', 'owner-1');
    const body = await res.json() as { data: { config: Record<string, unknown> } };
    expect(body.data.config.externalEndpointUrl).toBe('https://example.com/scan');
    expect(body.data.config.externalSecretRef).toBe('FILE_SCAN_API_KEY');
    expect(JSON.stringify(body.data.config)).not.toContain('secret-value');
  });
});
