import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { friendBulkRuns } from './friend-bulk-runs.js';

vi.mock('../services/friend-bulk-runs.js', () => ({
  createFriendBulkUndoRun: vi.fn(),
  FriendBulkRunError: class FriendBulkRunError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  },
  previewFriendBulkRun: vi.fn(),
  processFriendBulkRun: vi.fn(),
  requireFriendBulkRunAccess: vi.fn(),
  retryFriendBulkRun: vi.fn(),
  startFriendBulkRun: vi.fn(),
}));

function app(role: 'owner' | 'admin' | 'staff') {
  const instance = new Hono();
  instance.use('*', async (c, next) => {
    c.set('staff' as never, {
      id: `test-${role}`,
      name: role,
      role,
      readOnly: false,
      tenantId: 'default',
    } as never);
    await next();
  });
  instance.route('/', friendBulkRuns);
  return instance;
}

describe('友だち一括操作の入口', () => {
  it('スタッフ権限では本来管理者だけの一括変更と結果閲覧をさせない', async () => {
    const preview = await app('staff').request('/api/friends/bulk-runs/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selection: {}, operation: {} }),
    });
    const detail = await app('staff').request('/api/friends/bulk-runs/run-1');

    expect(preview.status).toBe(403);
    expect(detail.status).toBe(403);
  });

  it('壊れたJSONを内部エラーにせず利用者向けの400で返す', async () => {
    const response = await app('owner').request('/api/friends/bulk-runs/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_json' });
  });

  it('巨大な指定は読み口で止める', async () => {
    const response = await app('admin').request('/api/friends/bulk-runs/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'request_too_large' });
  });
});
