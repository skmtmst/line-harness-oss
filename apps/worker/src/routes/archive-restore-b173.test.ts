import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { tags } from './tags';
import { friendAttributes } from './friend-attributes';
import { automations } from './automations';
import { restoreTag } from '@line-crm/db';

const staff: AuthenticatedStaff = { id: 'admin', name: '管理者', role: 'admin', readOnly: false, tenantId: 'tenant-1' };
let testDb: SqliteD1;
function app(actor = staff) {
  const api = new Hono<Env>();
  api.use('*', async (c, next) => { c.env = { DB: testDb.db } as Env['Bindings']; c.set('staff', actor); await next(); });
  api.route('/', tags).route('/', friendAttributes).route('/', automations);
  return api;
}
const post = (body: unknown = { expectedVersion: 2 }) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const scoped = '?lineAccountId=account-1';

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.exec(`
    INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2');
    INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret, tenant_id)
      VALUES ('account-1', '店1', 'ch1', '', '', 'tenant-1'), ('account-2', '店2', 'ch2', '', '', 'tenant-2');
    INSERT INTO tags (id, name, line_account_id, status, version) VALUES ('tag', '保管タグ', 'account-1', 'archived', 2);
    INSERT INTO support_marks (id, name, color, archived_at, version, is_default, auto_on_inbound)
      VALUES ('mark', '保管マーク', '#94a3b8', '2026-10-09', 2, 0, 0), ('default', '初期値', '#94a3b8', NULL, 1, 1, 0);
    INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at) VALUES ('mark', 'tenant-1', 'account-1', datetime('now')), ('default', 'tenant-1', 'account-1', datetime('now'));
    INSERT INTO automation_definitions (id, line_account_id, name, status) VALUES ('rule', 'account-1', '保管ルール', 'archived'), ('draft', 'account-1', '保管下書き', 'archived');
    INSERT INTO automation_versions (id, automation_id, version_number, status, trigger_type, trigger_config, condition_config, action_config)
      VALUES ('rule-v1', 'rule', 1, 'published', 'message_received', '{}', '{}', '[]'), ('draft-v1', 'draft', 1, 'draft', 'message_received', '{}', '{}', '[]');
    UPDATE automation_definitions SET current_published_version_id = 'rule-v1' WHERE id = 'rule';
    UPDATE automation_definitions SET current_draft_version_id = 'draft-v1' WHERE id = 'draft';
  `);
});
afterEach(() => testDb.raw.close());

describe('B-173 保管から戻す', () => {
  it.each(['tags/tag', 'support-marks/mark'])('%sを戻し、版と監査を1回だけ進める', async path => {
    const api = app();
    expect((await api.request(`/api/${path}/restore${scoped}`, post())).status).toBe(200);
    expect((await api.request(`/api/${path}/restore${scoped}`, post())).status).toBe(200);
    const table = path.startsWith('tags') ? 'tags' : 'support_marks';
    const row = testDb.raw.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(path.split('/')[1]) as Record<string, unknown>;
    expect(row.version).toBe(3);
    expect(table === 'tags' ? row.status : row.archived_at).toBe(table === 'tags' ? 'active' : null);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM operation_audit').get()).toEqual({ n: 1 });
    if (table === 'support_marks') expect([row.is_default, row.auto_on_inbound]).toEqual([0, 0]);
  });

  it.each(['tags/tag', 'support-marks/mark'])('%sは古い版・別アカウント・閲覧のみから戻せない', async path => {
    expect((await app().request(`/api/${path}/restore${scoped}`, post({ expectedVersion: 1 }))).status).toBe(409);
    expect((await app().request(`/api/${path}/restore?lineAccountId=account-2`, post())).status).toBe(404);
    expect((await app({ ...staff, readOnly: true }).request(`/api/${path}/restore${scoped}`, post())).status).toBe(403);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM operation_audit').get()).toEqual({ n: 0 });
  });

  it('一覧の既定は保管を除外し、指定すると公開版も下書きも見える', async () => {
    const api = app();
    for (const path of ['support-marks', 'automations']) {
      const normal = await (await api.request(`/api/${path}${scoped}`)).json<{ data: Array<{ id: string }> }>();
      expect(normal.data.some((r: { id: string }) => ['mark', 'rule', 'draft'].includes(r.id))).toBe(false);
      const all = await (await api.request(`/api/${path}${scoped}&includeArchived=1`)).json<{ data: Array<{ id: string; archivedAt: string | null }> }>();
      expect(all.data.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining(path === 'automations' ? ['rule', 'draft'] : ['mark']));
      if (path === 'support-marks') expect(all.data.find((r: { id: string }) => r.id === 'mark')?.archivedAt).toBe('2026-10-09');
    }
  });

  it('ルールは停止中、公開前のものは下書きへ戻す。自動で動かさず同じ版を残す', async () => {
    const api = app();
    testDb.raw.exec(`INSERT INTO automation_runs
      (id, line_account_id, automation_id, automation_version_id, source_event_id, idempotency_key, status, input_event_json)
      VALUES ('history', 'account-1', 'rule', 'rule-v1', 'event', 'event-key', 'success', '{}')`);
    for (const [id, status] of [['rule', 'stopped'], ['draft', 'draft']]) {
      const res = await api.request(`/api/automations/${id}/restore${scoped}`, post({}));
      expect(res.status).toBe(200);
      expect((await res.json<{ data: { status: string } }>()).data.status).toBe(status);
      expect(testDb.raw.prepare('SELECT status FROM automation_definitions WHERE id = ?').get(id)).toEqual({ status });
      expect((await api.request(`/api/automations/${id}/restore${scoped}`, post({}))).status).toBe(200);
    }
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM automation_versions').get()).toEqual({ n: 2 });
    expect(testDb.raw.prepare("SELECT status FROM automation_runs WHERE id = 'history'").get()).toEqual({ status: 'success' });
    expect((await api.request('/api/automations/rule/restore?lineAccountId=account-2', post({}))).status).toBe(404);
    expect((await app({ ...staff, readOnly: true }).request(`/api/automations/rule/restore${scoped}`, post({}))).status).toBe(403);
  });

  it('保管時に置換した友だちのタグとマークは、戻しても付け替えない', async () => {
    testDb.raw.exec(`
      INSERT INTO tags (id, name, line_account_id) VALUES ('replacement', '置換先', 'account-1');
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, support_mark_id)
        VALUES ('friend', 'line-user', '顧客', 'account-1', 'default');
      INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend', 'replacement');
    `);
    for (const path of ['tags/tag', 'support-marks/mark']) expect((await app().request(`/api/${path}/restore${scoped}`, post())).status).toBe(200);
    expect(testDb.raw.prepare('SELECT friend_id, tag_id FROM friend_tags').all()).toEqual([{ friend_id: 'friend', tag_id: 'replacement' }]);
    expect(testDb.raw.prepare("SELECT support_mark_id FROM friends WHERE id = 'friend'").get()).toEqual({ support_mark_id: 'default' });
  });

  it('読み取り後にタグの版が変わっていたら、復元も監査も書かない', async () => {
    const pending = restoreTag(testDb.db, { id: 'tag', lineAccountId: 'account-1', expectedVersion: 2 });
    testDb.raw.exec("UPDATE tags SET version = 3 WHERE id = 'tag'");
    await expect(pending).rejects.toMatchObject({ code: 'version_conflict' });
    expect(testDb.raw.prepare("SELECT status FROM tags WHERE id = 'tag'").get()).toEqual({ status: 'archived' });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM operation_audit').get()).toEqual({ n: 0 });
  });

  it.each(['tags/tag', 'support-marks/mark'])('%sの監査保存に失敗したら復元も取り消す', async path => {
    testDb.raw.exec("CREATE TRIGGER fail_restore_audit BEFORE INSERT ON operation_audit BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
    expect((await app().request(`/api/${path}/restore${scoped}`, post())).status).toBe(500);
    const table = path.startsWith('tags') ? 'tags' : 'support_marks';
    const row = testDb.raw.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(path.split('/')[1]) as Record<string, unknown>;
    expect(row.version).toBe(2);
    expect(table === 'tags' ? row.status : row.archived_at).toBe(table === 'tags' ? 'archived' : '2026-10-09');
  });
});
