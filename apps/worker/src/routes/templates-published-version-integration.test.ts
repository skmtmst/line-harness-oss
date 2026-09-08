import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getTemplateById } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * 実DBで通す一気通貫(#645・差し戻し6要件)。
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

async function createTemplateOnDb(accountId = 'account-1'): Promise<string> {
  const response = await json('POST', '/api/templates', {
    accountId,
    name: 'あいさつ',
    messageType: 'text',
    messageContent: '最初の本文',
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { data: { id: string } };
  return body.data.id;
}

describe('実DB: 新規は未公開で始まり、初回公開で版1になる', () => {
  it('作成→未公開→公開の順で版が進む', async () => {
    const created = await json('POST', '/api/templates', {
      accountId: 'account-1',
      name: 'あいさつ',
      messageType: 'text',
      messageContent: '最初の本文',
    });
    const createdBody = (await created.json()) as { data: { id: string } };
    expect(createdBody).toMatchObject({
      success: true,
      data: { publishedVersion: 0, publishedAt: null, hasDraft: true, draftRevision: 1 },
    });
    expect(typeof createdBody.data.id).toBe('string');
  });

  it('PUT→公開の順で live 列が切り替わり、版が進む', async () => {
    const id = await createTemplateOnDb();

    const saved = await json('PUT', `/api/templates/${id}`, { messageContent: '編集中の本文' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      success: true,
      data: {
        messageContent: '編集中の本文',
        hasDraft: true,
        publishedVersion: 0,
        published: { messageContent: '最初の本文' },
      },
    });

    // 送信側が読む live 列は公開版のまま。
    const before = await getTemplateById(store.db, id);
    expect(before?.message_content).toBe('最初の本文');
    expect(before?.published_version).toBe(0);

    const published = await json('POST', `/api/templates/${id}/publish`, { expectedVersion: 0 }, 'e2e-key-0001');
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      success: true,
      data: {
        messageContent: '編集中の本文',
        publishedVersion: 1,
        published: true,
        replayed: false,
        hasDraft: false,
      },
    });

    const after = await getTemplateById(store.db, id);
    expect(after?.message_content).toBe('編集中の本文');
    expect(after?.published_version).toBe(1);

    // 同じ確認キーの再試行は同じ版を返す。
    const replayed = await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-key-0001');
    expect(await replayed.json()).toMatchObject({
      success: true,
      data: { publishedVersion: 1, published: false, replayed: true },
    });
  });

  it('別アカウントの公開は存在しないものとして返す', async () => {
    const id = await createTemplateOnDb();
    accountAccess.canAccessAllLineAccounts.mockResolvedValue(false);

    const response = await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-key-0002');
    expect(response.status).toBe(404);
  });
});

describe('実DB: 一覧は公開版を主に返し、アカウントで絞れる', () => {
  it('下書きがあっても一覧の主文は公開版で、未公開は目印つき', async () => {
    const id = await createTemplateOnDb();
    await json('PUT', `/api/templates/${id}`, { messageContent: '編集中の本文' });

    const listed = await app().request('/api/templates?account_id=account-1', {}, { DB: store.db } as Env['Bindings']);
    expect(listed.status).toBe(200);
    const body = await listed.json() as { data: Array<Record<string, unknown>> };
    const row = body.data.find((item) => item['id'] === id)!;
    // 主文は公開版(作った直後の内容)。未公開の目印つき。
    expect(row).toMatchObject({
      messageContent: '最初の本文',
      hasDraft: true,
      publishedVersion: 0,
      publishedAt: null,
    });
  });

  it('選んだアカウントと違う持ち主は一覧に出ない', async () => {
    const mine = await createTemplateOnDb('account-1');
    const other = await createTemplateOnDb('account-2');
    // 受信箱で選び直した後は、選んだアカウントの可視範囲だけになる。
    accountAccess.getVisibleLineAccountScope.mockResolvedValue({
      allowedAccountIds: ['account-1'],
      canSeeUnassigned: false,
    });

    const listed = await app().request('/api/templates?account_id=account-1', {}, { DB: store.db } as Env['Bindings']);
    const body = await listed.json() as { data: Array<Record<string, unknown>> };
    const ids = body.data.map((item) => item['id']);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(other);
  });
});

describe('実DB: 削除・同時編集・冪等の保証', () => {
  it('質問の削除は公開で消えたままになり、旧値が復活しない', async () => {
    const created = await json('POST', '/api/templates', {
      accountId: 'account-1',
      name: '質問つき',
      messageType: 'text',
      messageContent: '最初の本文',
      question: { text: '続けますか?', tapMode: 'single', choices: [{ label: 'はい', behavior: 'none' }] },
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-question-1');

    await json('PUT', `/api/templates/${id}`, { question: null });
    const published = await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-question-2');
    expect(published.status).toBe(200);

    const row = await getTemplateById(store.db, id);
    expect(row?.question_json).toBeNull();
  });

  it('検査後に下書きが変わったら、古い下書き版での公開を止める', async () => {
    const id = await createTemplateOnDb();
    await json('PUT', `/api/templates/${id}`, { messageContent: '確認した本文' });
    const detail = await app().request(`/api/templates/${id}`, {}, { DB: store.db } as Env['Bindings']);
    const seen = ((await detail.json()) as { data: { draftRevision: number } }).data;

    await json('PUT', `/api/templates/${id}`, { messageContent: '確認していない本文' });
    const stale = await json(
      'POST', `/api/templates/${id}/publish`,
      { expectedDraftRevision: seen.draftRevision }, 'e2e-draft-cas',
    );
    expect(stale.status).toBe(409);

    const row = await getTemplateById(store.db, id);
    expect(row?.published_version).toBe(0);
  });

  it('後日の同キー再試行では別の下書きを公開しない', async () => {
    const id = await createTemplateOnDb();
    await json('PUT', `/api/templates/${id}`, { messageContent: '最初の公開' });
    await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-reuse-key');

    await json('PUT', `/api/templates/${id}`, { messageContent: '次の編集' });
    const retry = await json('POST', `/api/templates/${id}/publish`, {}, 'e2e-reuse-key');
    expect(await retry.json()).toMatchObject({
      success: true,
      data: { published: false, replayed: true, publishedVersion: 1 },
    });

    const row = await getTemplateById(store.db, id);
    expect(row?.message_content).toBe('最初の公開');
  });
});
