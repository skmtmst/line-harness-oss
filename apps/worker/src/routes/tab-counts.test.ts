import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AutomationTabCounts, MediaTabCounts, ConversionApprovalCounts } from '@line-crm/shared';
import type { Env } from '../index.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { listAutomationTemplates } from '../services/automation-drafts.js';

const scope = vi.hoisted(() => ({ allowedAccountIds: ['a'], canSeeUnassigned: false }));
vi.mock('../services/account-access.js', async original => ({
  ...await original<typeof import('../services/account-access.js')>(),
  getVisibleLineAccountScope: async () => scope,
  canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) =>
    ids.every(id => scope.allowedAccountIds.includes(id)),
}));
import { automations } from './automations.js';
import { contents } from './contents.js';
import { conversions } from './conversions.js';

let sqlite: SqliteD1;
function application(role: 'admin' | 'staff' = 'admin', db?: D1Database, viewPermissionKeys: string[] = []) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'tester', name: 'Tester', role, readOnly: false,
      permissionKeys: [], viewPermissionKeys });
    await next();
  });
  app.route('/', automations).route('/', contents).route('/', conversions);
  return { request: (path: string) => app.request(path, {}, { DB: db ?? sqlite.db } as Env['Bindings']) };
}

beforeAll(() => {
  sqlite = createTestD1();
  for (const account of ['a', 'b']) {
    for (const status of ['draft', 'active', 'stopped', 'archived']) {
      sqlite.raw.prepare('INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES(?,?,?,?)')
        .run(`${account}-${status}`, account, status, status);
    }
    for (const status of ['draft', 'published', 'archived']) {
      sqlite.raw.prepare('INSERT INTO common_actions(id,line_account_id,name,status) VALUES(?,?,?,?)')
        .run(`${account}-${status}`, account, status, status);
    }
    for (const kind of ['image', 'video', 'audio', 'file']) {
      sqlite.raw.prepare('INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES(?,?,?,?,?,?,?)')
        .run(`${account}-${kind}`, account, kind, kind, 'test/type', 10, `${account}-${kind}`);
    }
    sqlite.raw.prepare("INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,archived_at) VALUES(?,?,'image','old','image/png',10,?,'2026-10-08')")
      .run(`${account}-old`, account, `${account}-old`);
    sqlite.raw.prepare("INSERT INTO media_usages(media_id,ref_kind,ref_id) VALUES(?,'broadcast','first'),(?,'broadcast','second')")
      .run(`${account}-image`, `${account}-image`);
    sqlite.raw.prepare("INSERT INTO conversion_points(id,name,event_type,line_account_id) VALUES(?,?,'custom',?)")
      .run(account, account, account);
  }
  sqlite.raw.prepare("INSERT INTO conversion_points(id,name,event_type) VALUES('unassigned','Unassigned','custom')").run();
  insertFriend(sqlite.raw, 'friend');
  for (const account of ['a', 'b', 'unassigned']) {
    for (const status of ['pending', 'approved', 'rejected']) {
      sqlite.raw.prepare('INSERT INTO conversion_events(id,conversion_point_id,friend_id,affiliate_id,approval_status) VALUES(?,?,?,?,?)')
        .run(`${account}-${status}`, account, 'friend', 'affiliate', status);
    }
  }
  sqlite.raw.prepare("INSERT INTO conversion_events(id,conversion_point_id,friend_id,approval_status) VALUES('organic','a','friend','pending')").run();
});
afterAll(() => sqlite.raw.close());

describe('タブ件数 API', () => {
  it('ルール・共通アクションは指定アカウントの保管前だけを数える', async () => {
    const res = await application().request('/api/automations/counts?account_id=a');
    expect(res.status).toBe(200);
    expect((await res.json<{data: AutomationTabCounts}>()).data).toEqual({ rules: 3, commonActions: 2, templates: listAutomationTemplates().length });
  });
  it('メディアの種類・未使用・保管済みを1回で返し、複数の使用先で二重に数えない', async () => {
    const res = await application().request('/api/media/counts?accountId=a');
    expect(res.status).toBe(200);
    expect((await res.json<{data: MediaTabCounts}>()).data).toEqual({ total: 4, byKind: { image: 1, video: 1, audio: 1, file: 1 }, unused: 3, archived: 1 });
  });
  it('紹介成果の承認状態だけを担当範囲から数え、通常成果・別店・未所属を除く', async () => {
    const res = await application().request('/api/conversions/approvals/counts');
    expect(res.status).toBe(200);
    expect((await res.json<{data: ConversionApprovalCounts}>()).data).toEqual({ pending: 1, approved: 1, rejected: 1, total: 3 });
  });
  it('統括の契約に沿って未所属の成果を含め、空の担当範囲は0件を返す', async () => {
    scope.canSeeUnassigned = true;
    const res = await application().request('/api/conversions/approvals/counts');
    expect((await res.json<{data: ConversionApprovalCounts}>()).data.total).toBe(6);
    scope.canSeeUnassigned = false;
    scope.allowedAccountIds = [];
    const empty = await application().request('/api/conversions/approvals/counts');
    expect((await empty.json<{data: ConversionApprovalCounts}>()).data.total).toBe(0);
    scope.allowedAccountIds = ['a'];
  });
  it('指定なし・別店へのアクセスを拒否する', async () => {
    for (const [path, status] of [
      ['/api/automations/counts', 400], ['/api/automations/counts?account_id=b', 404],
      ['/api/media/counts', 400], ['/api/media/counts?accountId=b', 404],
    ] as const) expect((await application().request(path)).status, path).toBe(status);
  });
  it('機能の閲覧権限を持つ担当者だけが件数を取得できる', async () => {
    expect((await application('staff').request('/api/automations/counts?account_id=a')).status).toBe(403);
    expect((await application('staff', undefined, ['/automations']).request('/api/automations/counts?account_id=a')).status).toBe(200);
    expect((await application('staff').request('/api/conversions/approvals/counts')).status).toBe(403);
  });
  it('DB失敗を0件と偽って返さない', async () => {
    const failing = { prepare: () => { throw new Error('unavailable'); } } as unknown as D1Database;
    for (const path of ['/api/automations/counts?account_id=a', '/api/media/counts?accountId=a', '/api/conversions/approvals/counts']) {
      const res = await application('admin', failing).request(path);
      expect(res.status, path).toBe(500);
      expect((await res.json<{success:boolean}>()).success).toBe(false);
    }
  });
});
