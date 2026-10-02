import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';
import { ensureAutoReplyPublishedVersion, getAutoReplyById } from '@line-crm/db';

/*
 * AUTOREPLY-09: 新規作成で入力した社内メモが、一覧の再読込と編集を開いた
 * ときに空になっていた。メモは auto_replies に列を持たず、版の
 * スナップショットにだけ置く。作成・更新・一覧・詳細・編集の読み込みで
 * 一貫して保持し、友だちへ送る本文へは混ぜない。
 */
const admin: AuthenticatedStaff = {
  id: 'env-owner',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 'tenant-1',
};

function app(db: D1Database, currentStaff: AuthenticatedStaff = admin) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', currentStaff);
    await next();
  });
  instance.route('/', autoReplies);
  return { instance, bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'] };
}

function request(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface Serialized {
  id: string;
  isActive: boolean;
  lifecycleStatus: string;
  internalMemo: string | null;
  responseContent: string;
}

describe('AUTOREPLY-09: 社内メモを作成・更新・一覧・詳細・編集で一貫して保持する', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
    ).run();
  });

  const post = (body: Record<string, unknown>) => app(testDb.db).instance.request(
    '/api/auto-replies', request('POST', body), app(testDb.db).bindings,
  );
  const put = (id: string, body: Record<string, unknown>) => app(testDb.db).instance.request(
    `/api/auto-replies/${id}`, request('PUT', body), app(testDb.db).bindings,
  );

  it('停止のまま新規作成したメモが、一覧・詳細・編集（版）の再読込で完全一致する', async () => {
    const target = app(testDb.db);
    const memo = '一次対応メモ\n改行と日本語を含む';
    const created = await target.instance.request('/api/auto-replies', request('POST', {
      keyword: '予約',
      matchType: 'contains',
      responseType: 'text',
      responseContent: '承りました',
      lineAccountId: 'account-1',
      isActive: false,
      internalMemo: memo,
    }), target.bindings);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { data: Serialized };
    const id = createdBody.data.id;
    // 停止状態は変えない（AUTOREPLY-08 の契約）。
    expect(createdBody.data.isActive).toBe(false);
    expect(createdBody.data.lifecycleStatus).toBe('stopped');
    expect(createdBody.data.internalMemo).toBe(memo);
    // メモを返信本文へ混ぜない。
    expect(createdBody.data.responseContent).toBe('承りました');

    // 一覧の再読込。
    const list = await target.instance.request('/api/auto-replies', {}, target.bindings);
    const listBody = await list.json() as { data: Serialized[] };
    expect(listBody.data.find((item) => item.id === id)?.internalMemo).toBe(memo);

    // 詳細の再読込（一覧の編集が読む形）。
    const detail = await target.instance.request(`/api/auto-replies/${id}`, {}, target.bindings);
    const detailBody = await detail.json() as { data: Serialized };
    expect(detailBody.data.internalMemo).toBe(memo);
    expect(detailBody.data.isActive).toBe(false);
    expect(detailBody.data.lifecycleStatus).toBe('stopped');

    // URL の編集画面が読む版の口（下書き→公開版）。
    const draft = await target.instance.request(`/api/auto-replies/${id}/draft`, {}, target.bindings);
    const draftBody = await draft.json() as {
      data: { settings: { internalMemo: string | null; responseContent: string } };
    };
    expect(draft.status).toBe(200);
    expect(draftBody.data.settings.internalMemo).toBe(memo);
    expect(draftBody.data.settings.responseContent).toBe('承りました');
  });

  it('既存更新でメモを書き換え・明示的に消せる。未指定の更新はメモを消さない', async () => {
    const target = app(testDb.db);
    const created = await post({
      keyword: '予約', responseContent: '承りました',
      lineAccountId: 'account-1', isActive: false, internalMemo: '初期メモ',
    });
    const id = ((await created.json()) as { data: Serialized }).data.id;

    // メモを持たない更新は既存のメモを消さない。
    const keepRes = await put(id, { keyword: '予約変更' });
    expect(keepRes.status).toBe(200);
    expect(((await keepRes.json()) as { data: Serialized }).data.internalMemo).toBe('初期メモ');

    // 書き換え（改行・日本語）。
    const rewritten = '引き継ぎ先はCS\n対応は平日のみ';
    const putRes = await put(id, { internalMemo: rewritten });
    expect(putRes.status).toBe(200);
    expect(((await putRes.json()) as { data: Serialized }).data.internalMemo).toBe(rewritten);

    // 明示的に空へ消す（'' と null のどちらでも消える）。
    for (const cleared of ['', null]) {
      const clearRes = await put(id, { internalMemo: cleared });
      expect(clearRes.status).toBe(200);
      expect(((await clearRes.json()) as { data: Serialized }).data.internalMemo).toBeNull();
      const detail = await target.instance.request(`/api/auto-replies/${id}`, {}, target.bindings);
      expect(((await detail.json()) as { data: Serialized }).data.internalMemo).toBeNull();
      const draft = await target.instance.request(`/api/auto-replies/${id}/draft`, {}, target.bindings);
      const draftBody = await draft.json() as { data: { settings: { internalMemo: string | null } } };
      expect(draftBody.data.settings.internalMemo).toBeNull();
      await put(id, { internalMemo: '復元' });
    }
  });

  it('メモの上限は1000文字。1001文字は作らず・更新もしない', async () => {
    const ok = await post({
      keyword: '予約', responseContent: '承りました',
      lineAccountId: 'account-1', internalMemo: 'あ'.repeat(1000),
    });
    expect(ok.status).toBe(201);
    const okBody = await ok.json() as { data: Serialized };
    expect(okBody.data.internalMemo).toBe('あ'.repeat(1000));
    const id = okBody.data.id;

    expect((await post({
      keyword: '予約', responseContent: '承りました',
      lineAccountId: 'account-1', internalMemo: 'あ'.repeat(1001),
    })).status).toBe(400);
    expect((await put(id, { internalMemo: 'あ'.repeat(1001) })).status).toBe(400);
    // 型違いも保存しない。
    expect((await put(id, { internalMemo: 42 })).status).toBe(400);
  });

  it('定義の更新後に実行版が張り替わってもメモを引き継ぐ', async () => {
    const target = app(testDb.db);
    const created = await post({
      keyword: '予約', responseContent: '承りました',
      lineAccountId: 'account-1', isActive: true, internalMemo: '残したいメモ',
    });
    const id = ((await created.json()) as { data: Serialized }).data.id;

    // メモを書かない定義更新（従来の更新口）。
    await put(id, { keyword: '予約変更' });
    const updated = await getAutoReplyById(testDb.db, id);
    // 実行時に版を張り替える処理を直接呼び、新版へメモが引き継がれるか見る。
    const version = await ensureAutoReplyPublishedVersion(testDb.db, updated!);
    const snapshot = JSON.parse(version.definition_snapshot) as { internalMemo?: string | null };
    expect(snapshot.internalMemo).toBe('残したいメモ');

    const detail = await target.instance.request(`/api/auto-replies/${id}`, {}, target.bindings);
    expect(((await detail.json()) as { data: Serialized }).data.internalMemo).toBe('残したいメモ');
  });
});
