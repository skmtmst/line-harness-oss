import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getTemplateById } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * 公開の原子性と同時実行(#645・独立審査P1/P2)。
 * 版の更新と確認キーの記録は1つの原子操作なので、D1の途中障害でも
 * 「版だけ進む」ことはない。同時publishは1つだけ通り、負けは409。
 * 同じ確認キーの同時再試行は、版を進めず両方200で返す。
 */

const accountAccess = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));
vi.mock('../services/account-access.js', () => accountAccess);

import { templates } from './templates.js';

function app() {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  hono.route('/', templates);
  return hono;
}

function json(method: string, path: string, body: unknown, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  return app().request(path, {
    method,
    headers,
    body: JSON.stringify(body),
  }, { DB: store.db } as Env['Bindings']);
}

let store: SqliteD1;

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true);
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  });
  store = createTestD1();
});

async function createDraftOnDb(content = '下書きの本文'): Promise<string> {
  const created = await json('POST', '/api/templates', {
    accountId: 'account-1',
    name: 'あいさつ',
    messageType: 'text',
    messageContent: '最初の本文',
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { data: { id: string } }).data.id;
  const updated = await json('PUT', `/api/templates/${id}`, { messageContent: content });
  expect(updated.status).toBe(200);
  return id;
}

describe('実DB: D1の途中障害でも版だけ進まない', () => {
  it('記録表が壊れていて公開に失敗したら、版も下書きも動かない', async () => {
    const id = await createDraftOnDb('消えては困る下書き');
    // D1の途中障害の再現: 版の更新と同じ原子操作にある記録表を落とす。
    // 版の UPDATE が先に確定してしまう実装なら、版だけ進んでしまう。
    store.raw.exec('DROP TABLE template_publish_keys');

    const response = await json(
      'POST', `/api/templates/${id}/publish`,
      { expectedVersion: 0, expectedDraftRevision: 2 }, 'e2e-mid-failure-key',
    );
    expect(response.status).toBe(500);

    const row = await getTemplateById(store.db, id);
    expect(row?.published_version).toBe(0);
    expect(row?.message_content).toBe('最初の本文');
    expect(row?.draft_message_content).toBe('消えては困る下書き');
    expect(Number(row?.draft_revision)).toBe(2);
  });
});

describe('実DB: 同じ確認キーの同時publishは版を1つだけ進める', () => {
  it('両方200で、片方は公開・片方は記録の再生になる', async () => {
    const id = await createDraftOnDb('同時の公開');
    const [first, second] = await Promise.all([
      json('POST', `/api/templates/${id}/publish`,
        { expectedVersion: 0, expectedDraftRevision: 2 }, 'e2e-same-key-race'),
      json('POST', `/api/templates/${id}/publish`,
        { expectedVersion: 0, expectedDraftRevision: 2 }, 'e2e-same-key-race'),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const bodies = [await first.json(), await second.json()] as Array<{
      data: { published: boolean; replayed: boolean; publishedVersion: number };
    }>;
    expect(bodies.map((b) => b.data.published).sort()).toEqual([false, true]);
    expect(bodies.map((b) => b.data.publishedVersion)).toEqual([1, 1]);

    const row = await getTemplateById(store.db, id);
    expect(row?.published_version).toBe(1);
    expect(row?.message_content).toBe('同時の公開');
  });
});
