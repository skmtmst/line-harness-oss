/*
 * シナリオアクションの参照検証を、本物のルートと本物の SQLite で確かめる(N-053)。
 *
 * 手書きモックだと「幽霊IDが保存されない」「他アカウントが弾かれる」
 * 「弾かれたときに1行も残らない」を確かめられない。ここは実物の
 * `scenarios` ルートを実 D1 に載せ、行の有無まで当てる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { scenarios } from './scenarios';

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'ten-1',
};

function app(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', owner);
    await next();
  });
  instance.route('/', scenarios);
  return instance;
}

function seed(testDb: SqliteD1): void {
  const raw = testDb.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const [id, label] of [['acc-a', '公式A'], ['acc-b', '公式B']] as const) {
    raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, 'tenant-1')`,
    ).run(id, `channel-${id}`, label);
  }
  raw.prepare(
    `INSERT INTO tags (id, name, created_at, line_account_id) VALUES
       ('tag-a', 'Aのタグ', '2026-08-16', 'acc-a'),
       ('tag-b', 'Bのタグ', '2026-08-16', 'acc-b')`,
  ).run();
  raw.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, created_at, updated_at, line_account_id) VALUES
       ('scn-a', 'Aの案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', 'acc-a'),
       ('scn-b', 'Bの案内', 'manual', 1, 'relative', '2026-08-16', '2026-08-16', 'acc-b')`,
  ).run();
  raw.prepare(
    `INSERT INTO templates (id, name, message_type, message_content, created_at, updated_at, line_account_id) VALUES
       ('tpl-a', 'Aの文', 'text', 'A', '2026-08-16', '2026-08-16', 'acc-a'),
       ('tpl-b', 'Bの文', 'text', 'B', '2026-08-16', '2026-08-16', 'acc-b')`,
  ).run();
  raw.prepare(
    `INSERT INTO common_vars (id, name, var_key, line_account_id, archived_at) VALUES
       ('var-a', 'Aの変数', 'shop_hours', 'acc-a', NULL),
       ('var-b', 'Bの変数', 'shop_hours', 'acc-b', NULL)`,
  ).run();
  // 統括1は seed 済み。統括2とその口座だけ足す。口座の統括は seed の tenant-1 から ten-1 へ寄せる。
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('ten-1', '統括1'), ('ten-2', '統括2')`).run();
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('acc-c', 'channel-acc-c', '公式C', 'token', 'secret', 1, 'ten-2')`,
  ).run();
  raw.prepare(`UPDATE line_accounts SET tenant_id = 'ten-1' WHERE id IN ('acc-a', 'acc-b')`).run();
  raw.prepare(
    `INSERT INTO reminders (id, name, line_account_id, deleted_at) VALUES
       ('rem-a', 'Aの記念日', 'acc-a', NULL),
       ('rem-b', 'Bの記念日', 'acc-b', NULL)`,
  ).run();
  raw.prepare(
    `INSERT INTO support_marks (id, name, archived_at) VALUES
       ('mk-a', 'Aの要対応', NULL),
       ('mk-other-tenant', '統括2の要対応', NULL)`,
  ).run();
  raw.prepare(
    `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at) VALUES
       ('mk-a', 'ten-1', 'acc-a', '2026-08-16'),
       ('mk-other-tenant', 'ten-2', 'acc-c', '2026-08-16')`,
  ).run();
  raw.prepare(
    `INSERT INTO events (id, line_account_id, name, deleted_at) VALUES
       ('ev-a', 'acc-a', 'Aの会', NULL)`,
  ).run();
}

function actionCount(testDb: SqliteD1, scenarioId = 'scn-a'): number {
  return (testDb.raw.prepare(`SELECT COUNT(*) AS c FROM scenario_actions WHERE scenario_id = ?`)
    .get(scenarioId) as { c: number }).c;
}

function postAction(db: D1Database, scenarioId: string, body: unknown) {
  return app(db).request(`/api/scenarios/${scenarioId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const tagBody = (config: unknown) => ({
  hook: 'scenario_completed',
  actionType: 'tag',
  config,
});

describe('シナリオアクションの参照検証（N-053・実route＋実SQLite）', () => {
  let testDb: SqliteD1;
  let db: D1Database;

  beforeEach(() => {
    testDb = createTestD1();
    db = testDb.db;
    seed(testDb);
  });

  it('幽霊タグは400で1行も残さない（#779 の再現）', async () => {
    const response = await postAction(db, 'scn-a', tagBody({ op: 'add', tagIds: ['tag-ghost'] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(actionCount(testDb)).toBe(0);
  });

  it('別アカウントのタグ・テンプレート・変数は400で残さない', async () => {
    const tag = await postAction(db, 'scn-a', tagBody({ op: 'add', tagIds: ['tag-b'] }));
    expect(tag.status).toBe(400);
    const template = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'send_template', config: { templateId: 'tpl-b' },
    });
    expect(template.status).toBe(400);
    const variable = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'common_var', config: { varKey: 'shop_hours', op: 'add' },
    });
    // var-b と同じキーだが acc-a の行 var-a があるので通る。消して確かめる。
    expect(variable.status).toBe(200);
    testDb.raw.prepare(`DELETE FROM common_vars WHERE id = 'var-a'`).run();
    const cross = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'common_var', config: { varKey: 'shop_hours', op: 'add' },
    });
    expect(cross.status).toBe(400);
    expect(actionCount(testDb)).toBe(1);
  });

  it('正常な同一アカウント参照を通す', async () => {
    const response = await postAction(db, 'scn-a', tagBody({ op: 'add', tagIds: ['tag-a'] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(actionCount(testDb)).toBe(1);
  });

  it('別アカウントのリマインダは400で残さない（R1）', async () => {
    const cross = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'reminder', config: { reminderId: 'rem-b' },
    });
    expect(cross.status).toBe(400);
    const same = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'reminder', config: { reminderId: 'rem-a' },
    });
    expect(same.status).toBe(200);
    expect(actionCount(testDb)).toBe(1);
  });

  it('別テナントの対応マークは400で残さない（R2）', async () => {
    const cross = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'support_mark', config: { markId: 'mk-other-tenant' },
    });
    expect(cross.status).toBe(400);
    const same = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'support_mark', config: { markId: 'mk-a' },
    });
    expect(same.status).toBe(200);
    expect(actionCount(testDb)).toBe(1);
  });

  it('無いシナリオには404で残さない', async () => {
    const response = await postAction(db, 'scn-ghost', tagBody({ op: 'add', tagIds: ['tag-a'] }));
    expect(response.status).toBe(404);
    expect(actionCount(testDb)).toBe(0);
  });

  it('更新で幽霊に変えようとすると400で元の設定が残る', async () => {
    const created = await postAction(db, 'scn-a', tagBody({ op: 'add', tagIds: ['tag-a'] }));
    expect(created.status).toBe(200);
    const createdBody = (await created.json() as { data: { id: string } }).data;
    const before = testDb.raw
      .prepare(`SELECT config_json AS config FROM scenario_actions WHERE id = ?`)
      .get(createdBody.id) as { config: string };

    const response = await app(db).request(`/api/scenarios/scn-a/actions/${createdBody.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { op: 'add', tagIds: ['tag-ghost'] }, sortOrder: 9 }),
    });
    expect(response.status).toBe(400);
    // 部分保存なし。設定も並び順も動いていない。
    const after = testDb.raw
      .prepare(`SELECT config_json AS config, sort_order AS sortOrder FROM scenario_actions WHERE id = ?`)
      .get(createdBody.id) as { config: string; sortOrder: number };
    expect(after.config).toBe(before.config);
    expect(after.sortOrder).toBe(0);
  });

  it('並び順だけの変更は既存の幽霊があっても通す', async () => {
    const id = 'action-legacy-ghost';
    testDb.raw.prepare(
      `INSERT INTO scenario_actions
         (id, scenario_id, hook, step_id, choice_index, sort_order,
          action_type, config_json, condition_json, repeat_on_refire)
       VALUES (?, 'scn-a', 'scenario_completed', NULL, NULL, 0,
          'tag', ?, NULL, 1)`,
    ).run(id, JSON.stringify({ op: 'add', tagIds: ['tag-ghost'] }));

    const response = await app(db).request(`/api/scenarios/scn-a/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: 3 }),
    });
    expect(response.status).toBe(200);
    expect((testDb.raw.prepare(`SELECT sort_order AS s FROM scenario_actions WHERE id = ?`)
      .get(id) as { s: number }).s).toBe(3);
  });

  it('消したイベント・無いリマインダは400で残さない', async () => {
    testDb.raw.prepare(`UPDATE events SET deleted_at = '2026-08-01' WHERE id = 'ev-a'`).run();
    const event = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'event_booking', config: { eventId: 'ev-a' },
    });
    expect(event.status).toBe(400);
    const reminder = await postAction(db, 'scn-a', {
      hook: 'scenario_completed', actionType: 'reminder', config: { reminderId: 'rem-ghost' },
    });
    expect(reminder.status).toBe(400);
    expect(actionCount(testDb)).toBe(0);
  });
});
