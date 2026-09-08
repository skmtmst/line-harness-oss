import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getTemplateById } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * 実DBで通す一気通貫(#645)。
 * 保存→下書きにだけ書かれ、送信側が読む live 列は公開操作まで不変。
 * モック単体の契約は templates-published-version.test.ts にある。
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

async function createTemplateOnDb(): Promise<string> {
  const response = await json('POST', '/api/templates', {
    accountId: 'account-1',
    name: 'あいさつ',
    messageType: 'text',
    messageContent: '最初の本文',
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { data: { id: string } };
  return body.data.id;
}

describe('実DB: 保存は公開版を変えず、公開で切り替わる', () => {
  it('PUT→公開の順で live 列が切り替わり、版が進む', async () => {
    const id = await createTemplateOnDb();

    const saved = await json('PUT', `/api/templates/${id}`, { messageContent: '編集中の本文' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      success: true,
      data: {
        messageContent: '編集中の本文',
        hasDraft: true,
        publishedVersion: 1,
        published: { messageContent: '最初の本文' },
      },
    });

    // 送信側が読む live 列は公開版のまま。
    const before = await getTemplateById(store.db, id);
    expect(before?.message_content).toBe('最初の本文');
    expect(before?.published_version).toBe(1);

    const published = await json('POST', `/api/templates/${id}/publish`, { expectedVersion: 1 }, 'e2e-key-0001');
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      success: true,
      data: {
        messageContent: '編集中の本文',
        publishedVersion: 2,
        published: true,
        replayed: false,
        hasDraft: false,
      },
    });

    const after = await getTemplateById(store.db, id);
    expect(after?.message_content).toBe('編集中の本文');
    expect(after?.published_version).toBe(2);

    // 同じ確認キーの再試行は同じ版を返す。
    const replayed = await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-key-0001');
    expect(await replayed.json()).toMatchObject({
      success: true,
      data: { publishedVersion: 2, published: false, replayed: true },
    });
  });

  it('別アカウントの公開は存在しないものとして返す', async () => {
    const id = await createTemplateOnDb();
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);

    const response = await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-key-0002');
    expect(response.status).toBe(404);
  });
});
