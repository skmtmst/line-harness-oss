import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createBroadcast,
  createScenarioStep,
  getBroadcastById,
  updateBroadcast,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * #820: テンプレートの版履歴と参照表。
 * 公開のたびに版を足す（前の版は変えない）。戻すは新しい版を作る。
 * 予約済み・送信中の配信で使うものは消せない。送った配信は送った時の版のまま。
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

function json(method: string, path: string, body?: unknown, key?: string, db = store.db) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  return app().request(path, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body ?? {}) }),
  }, { DB: db } as Env['Bindings']);
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

async function createTemplateOnApi(content = '最初の本文'): Promise<string> {
  const response = await json('POST', '/api/templates', {
    accountId: 'account-1',
    name: 'あいさつ',
    messageType: 'text',
    messageContent: content,
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { data: { id: string } };
  return body.data.id;
}

async function publishOnApi(id: string, content: string, key: string): Promise<number> {
  if (content !== '') {
    const saved = await json('PUT', `/api/templates/${id}`, { messageContent: content });
    expect(saved.status).toBe(200);
  }
  const detail = await json('GET', `/api/templates/${id}`, {});
  const versions = await detail.json() as {
    data: { publishedVersion: number; draftRevision: number };
  };
  const published = await json('POST', `/api/templates/${id}/publish`, {
    expectedVersion: versions.data.publishedVersion,
    expectedDraftRevision: versions.data.draftRevision,
  }, key);
  expect(published.status).toBe(200);
  const publishedBody = await published.json() as { data: { publishedVersion: number } };
  return publishedBody.data.publishedVersion;
}

async function versionsOnApi(id: string) {
  const response = await json('GET', `/api/templates/${id}/versions`, {});
  expect(response.status).toBe(200);
  return (await response.json()) as {
    data: Array<{
      versionNumber: number;
      status: string;
      messageContent: string;
      effectiveFrom: string | null;
    }>;
  };
}

describe('版の履歴', () => {
  it('未公開のままでは版がない', async () => {
    const id = await createTemplateOnApi();
    const versions = await versionsOnApi(id);
    expect(versions.data).toEqual([]);
  });

  it('公開のたびに版が足され、前の版は変わらない', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    await publishOnApi(id, '直した本文', 'testkey-v2');
    const versions = await versionsOnApi(id);
    expect(versions.data.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(versions.data.find((v) => v.versionNumber === 1)?.messageContent).toBe('最初の本文');
    expect(versions.data.find((v) => v.versionNumber === 2)?.messageContent).toBe('直した本文');
    expect(versions.data.find((v) => v.versionNumber === 2)?.status).toBe('in_use');
    expect(versions.data.find((v) => v.versionNumber === 1)?.status).toBe('past');
  });

  it('同じ確認キーの再送では版が増えない', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-once');
    const detail = await json('GET', `/api/templates/${id}`, {});
    const current = await detail.json() as {
      data: { publishedVersion: number; draftRevision: number };
    };
    const replayed = await json('POST', `/api/templates/${id}/publish`, {
      expectedVersion: current.data.publishedVersion,
      expectedDraftRevision: current.data.draftRevision,
    }, 'testkey-once');
    expect(replayed.status).toBe(200);
    const versions = await versionsOnApi(id);
    expect(versions.data).toHaveLength(1);
  });

  it('存在しないテンプレートの版は404', async () => {
    const response = await json('GET', '/api/templates/no-such/versions', {});
    expect(response.status).toBe(404);
  });
});

describe('この版に戻す', () => {
  it('過去の版の中身で新しい版ができる。過去は変わらない', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    await publishOnApi(id, '直した本文', 'testkey-v2');
    const reverted = await json('POST', `/api/templates/${id}/revert`, {
      versionNumber: 1,
      expectedVersion: 2,
    }, 'testkey-revert');
    expect(reverted.status).toBe(200);
    const revertedBody = await reverted.json() as { data: { publishedVersion: number } };
    expect(revertedBody.data.publishedVersion).toBe(3);
    const detail = await json('GET', `/api/templates/${id}`, {});
    const current = await detail.json() as { data: { messageContent: string } };
    expect(current.data.messageContent).toBe('最初の本文');
    const versions = await versionsOnApi(id);
    expect(versions.data.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(versions.data.find((v) => v.versionNumber === 1)?.messageContent).toBe('最初の本文');
    expect(versions.data.find((v) => v.versionNumber === 3)?.status).toBe('in_use');
  });

  it('同じ確認キーの再送では版が増えない', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    await publishOnApi(id, '直した本文', 'testkey-v2');
    await json('POST', `/api/templates/${id}/revert`, {
      versionNumber: 1,
      expectedVersion: 2,
    }, 'testkey-revert-twice');
    const again = await json('POST', `/api/templates/${id}/revert`, {
      versionNumber: 1,
      expectedVersion: 2,
    }, 'testkey-revert-twice');
    // 1回目で版が進んだため、版確認で409。新しい版は増えない。
    expect([200, 409]).toContain(again.status);
    const versions = await versionsOnApi(id);
    expect(versions.data.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
  });

  it('確認キーがなければ400、無い版は404、古い版確認は409', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    const noKey = await json('POST', `/api/templates/${id}/revert`, {
      versionNumber: 1,
      expectedVersion: 1,
    });
    expect(noKey.status).toBe(400);
    const missing = await json('POST', `/api/templates/${id}/revert`, {
      versionNumber: 9,
      expectedVersion: 1,
    }, 'testkey-missing');
    expect(missing.status).toBe(404);
    await publishOnApi(id, '直した本文', 'testkey-v2');
    const stale = await json('POST', `/api/templates/${id}/revert`, {
      versionNumber: 1,
      expectedVersion: 1,
    }, 'testkey-stale');
    expect(stale.status).toBe(409);
  });
});

describe('参照表と削除の止め', () => {
  async function scheduledBroadcastUsing(templateId: string) {
    return createBroadcast(store.db, {
      title: '秋の会員向け案内',
      messageType: 'text',
      messageContent: '秋の案内です',
      messageBubblesJson: JSON.stringify([
        { id: 'b1', type: 'text', content: { text: '秋の案内です', templateId } },
      ]),
      targetType: 'all',
      scheduledAt: '2099-10-01T10:00:00+09:00',
      lineAccountId: 'account-1',
    });
  }

  it('予約済みの配信で使うものは409で理由が返る', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    await scheduledBroadcastUsing(id);
    const response = await json('DELETE', `/api/templates/${id}`, {});
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string; code: string };
    expect(body.code).toBe('IN_USE');
    expect(body.error).toContain('予約済み・送信中');
  });

  it('送った配信は削除を止めない。版は送った時のまま残る', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    const broadcast = await scheduledBroadcastUsing(id);
    const current = await getBroadcastById(store.db, broadcast.id);
    await updateBroadcast(store.db, broadcast.id, { status: 'sent' }, Number(current!.lock_version ?? 1));
    const response = await json('DELETE', `/api/templates/${id}`, {});
    expect(response.status).toBe(200);
  });

  it('下書きの配信は削除を止めない', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    await createBroadcast(store.db, {
      title: '下書きの案内',
      messageType: 'text',
      messageContent: '下書きです',
      messageBubblesJson: JSON.stringify([
        { id: 'b1', type: 'text', content: { text: '下書きです', templateId: id } },
      ]),
      targetType: 'all',
      lineAccountId: 'account-1',
    });
    const response = await json('DELETE', `/api/templates/${id}`, {});
    expect(response.status).toBe(200);
  });

  it('シナリオの手順を保存すると使っている版が記録される', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    store.raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, line_account_id) VALUES ('sc-1', '初回来店のお礼', 'manual', 'account-1')`,
    ).run();
    await createScenarioStep(store.db, {
      scenarioId: 'sc-1',
      stepOrder: 1,
      messageType: 'text',
      messageContent: '控え',
      templateId: id,
    });
    const usages = await json('GET', `/api/templates/${id}/usages`, {});
    expect(usages.status).toBe(200);
    const body = await usages.json() as {
      data: { scenarioSteps: Array<{ scenarioId: string; templateVersion: number | null }> };
    };
    expect(body.data.scenarioSteps).toHaveLength(1);
    expect(body.data.scenarioSteps[0].templateVersion).toBe(1);
    // 版を進めても、参照側の版は1のまま。
    await publishOnApi(id, '直した本文', 'testkey-v2');
    const again = await json('GET', `/api/templates/${id}/usages`, {});
    const againBody = await again.json() as {
      data: { scenarioSteps: Array<{ templateVersion: number | null }> };
    };
    expect(againBody.data.scenarioSteps[0].templateVersion).toBe(1);
  });

  it('一斉配信の参照は送った時の版で残る', async () => {
    const id = await createTemplateOnApi('最初の本文');
    await publishOnApi(id, '', 'testkey-v1');
    await scheduledBroadcastUsing(id);
    await publishOnApi(id, '直した本文', 'testkey-v2');
    const usages = await json('GET', `/api/templates/${id}/usages`, {});
    const body = await usages.json() as {
      data: { broadcasts: Array<{ title: string; status: string; templateVersionNumber: number | null }> };
    };
    expect(body.data.broadcasts).toHaveLength(1);
    expect(body.data.broadcasts[0].title).toBe('秋の会員向け案内');
    expect(body.data.broadcasts[0].templateVersionNumber).toBe(1);
  });
});
