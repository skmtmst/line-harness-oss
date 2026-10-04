import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { fileScan } from './file-scan.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * 板 `PfA4o` の「戻した」札。`status=released` は戻した（`released_at` あり）
 * だけを返し、一度も止められていない `clean` は混ぜない。
 */

let testDb: SqliteD1;

function insertAccount(id: string): void {
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, `channel-${id}`, id, `token-${id}`, `secret-${id}`, DEFAULT_TENANT_ID,
    );
}

function insertStaff(id: string): void {
  testDb.raw.prepare(`INSERT INTO staff_members
    (id, name, role, api_key, is_active, tenant_id, permission_keys, access_level)
    VALUES (?, ?, ?, ?, 1, ?, '[]', 'full')`).run(
      id, id, 'owner', `key-${id}`, DEFAULT_TENANT_ID,
    );
}

function insertScan(id: string, status: string, releasedAt: string | null): void {
  testDb.raw.prepare(`INSERT INTO media_file_scans
    (id, line_account_id, subject_kind, subject_id, media_id, filename, mime_type,
     size_bytes, status, reason_code, reason_detail, attempts, next_retry_at,
     scanned_at, quarantined_at, released_at, release_reason, released_by,
     created_at, updated_at)
    VALUES (@id, @line_account_id, @subject_kind, @subject_id, @media_id, @filename,
     @mime_type, @size_bytes, @status, @reason_code, @reason_detail, @attempts,
     @next_retry_at, @scanned_at, @quarantined_at, @released_at, @release_reason,
     @released_by, @created_at, @updated_at)`).run({
      id, line_account_id: 'acc-1', subject_kind: 'media', subject_id: 'md-1', media_id: 'md-1',
      filename: `${id}.png`, mime_type: 'image/png', size_bytes: 100, status,
      reason_code: 'trailing_data', reason_detail: '画像の後ろに別のデータがあります',
      attempts: 0, next_retry_at: null, scanned_at: '2026-09-25T10:00:00+09:00',
      quarantined_at: '2026-09-25T10:00:00+09:00', released_at: releasedAt,
      release_reason: releasedAt ? '誤りなので戻す' : null, released_by: releasedAt ? 'owner-1' : null,
      created_at: '2026-09-25T10:00:00+09:00', updated_at: '2026-09-25T10:00:00+09:00',
    });
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

async function get(path: string): Promise<Response> {
  return app().request(path, {
    method: 'GET',
    headers: { Authorization: 'Bearer key-owner-1' },
  }, environment());
}

beforeEach(() => {
  testDb = createTestD1();
  insertAccount('acc-1');
  insertStaff('owner-1');
});

describe('戻した一覧', () => {
  it('released は戻したものだけを返す', async () => {
    insertScan('quarantined-1', 'quarantined', null);
    insertScan('released-1', 'clean', '2026-09-26T10:00:00+09:00');
    insertScan('clean-1', 'clean', null);
    const res = await get('/api/file-scans?accountId=acc-1&status=released');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { items: Array<{ id: string }>; total: number } };
    expect(body.success).toBe(true);
    expect(body.data.items.map((item) => item.id)).toEqual(['released-1']);
    expect(body.data.total).toBe(1);
  });
});
