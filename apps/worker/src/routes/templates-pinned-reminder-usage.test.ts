/*
 * R347: 古い版で送信待ちの通知があっても、テンプレートの使用先が0件と
 * 数えられて削除できてしまう。
 *
 * ここで止めたい崩れ方:
 *   1. 旧公開版に固定された送信待ちの登録があるのに、使用先に0件と出る。
 *   2. そのまま DELETE が 200 で通り、テンプレートが消える。
 *      消えた後の初回通知は、元のテンプレート本文ではなく版に残っていた
 *      控え本文に変わる（buildReminderStepMessage は行が無いと控えへ落ちる）。
 *   3. 送信が終わった（completed）登録まで削除を止め続ける。
 *   4. 取消ずみ（cancelled・再開できる）の登録を見落とす。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物の templates ルートを当て、
 * アカウント権限だけ止める。送信自体はしない。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { getTemplatesWithUsageCount } from '@line-crm/db';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: [], canSeeUnassigned: true })),
}));

const { templates } = await import('./templates.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings'];
    c.set('staff', owner);
    await next();
  });
  instance.route('/', templates);
  return instance;
}

function exec(sql: string, params: unknown[] = []) {
  const stmt = (sqlite.db as unknown as {
    prepare: (s: string) => {
      bind: (...p: unknown[]) => { run: () => Promise<unknown>; all: () => Promise<unknown>; first: () => Promise<unknown> };
    };
  }).prepare(sql);
  return stmt.bind(...params).run();
}

/**
 * 版1（テンプレートA）で登録したあと、ルールを版2（テンプレートB）へ
 * 切り替えた状態。現行の reminder_steps はBだけを見る。
 */
async function seedSwitchedRule() {
  await exec(`INSERT INTO templates (id, name, message_type, message_content)
    VALUES ('tpl-a', '案内A', 'text', '本文A'), ('tpl-b', '案内B', 'text', '本文B')`);
  await exec(`INSERT INTO reminders (id, name) VALUES ('rem-1', '来店前日')`);
  // 版の手順は下書きの間だけ足せる（公開ずみは不変・トリガで止まる）。先に下書きで
  // 作ってから公開・旧版へ進めるのが本物の公開手順と同じ。
  await exec(`INSERT INTO reminder_versions (id, reminder_id, version_number, status, settings_snapshot, created_at, updated_at)
    VALUES ('rv-1', 'rem-1', 1, 'draft', '{}', '2026-09-01T00:00:00', '2026-09-01T00:00:00')`);
  await exec(`INSERT INTO reminder_version_steps
    (id, reminder_version_id, stable_step_id, offset_minutes, message_type, message_content, template_id, created_at)
    VALUES ('rvs-1', 'rv-1', 'step-1', 60, 'text', '控えA', 'tpl-a', '2026-09-01T00:00:00')`);
  await exec(`UPDATE reminder_versions SET status = 'published' WHERE id = 'rv-1'`);
  await exec(`INSERT INTO reminder_versions (id, reminder_id, version_number, status, settings_snapshot, created_at, updated_at)
    VALUES ('rv-2', 'rem-1', 2, 'draft', '{}', '2026-09-02T00:00:00', '2026-09-02T00:00:00')`);
  await exec(`INSERT INTO reminder_version_steps
    (id, reminder_version_id, stable_step_id, offset_minutes, message_type, message_content, template_id, created_at)
    VALUES ('rvs-2', 'rv-2', 'step-1', 60, 'text', '控えB', 'tpl-b', '2026-09-02T00:00:00')`);
  await exec(`UPDATE reminder_versions SET status = 'superseded' WHERE id = 'rv-1'`);
  await exec(`UPDATE reminder_versions SET status = 'published' WHERE id = 'rv-2'`);
  await exec(`INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content, template_id)
    VALUES ('rs-now', 'rem-1', 60, 'text', '現行B', 'tpl-b')`);
}

async function seedEnrollment(id: string, status: string) {
  await exec(
    `INSERT INTO friend_reminders (id, friend_id, reminder_id, reminder_version_id, target_date, status)
     VALUES (?, 'fr-friend', 'rem-1', 'rv-1', '2026-10-05', ?)`,
    [id, status],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = createTestD1();
});

describe('R347 旧版に固定された送信待ちの登録', () => {
  test('使用先に登録・件数・版が出る', async () => {
    await seedSwitchedRule();
    await seedEnrollment('fr-active', 'active');

    const response = await app().request('/api/templates/tpl-a/usages');
    const body = await response.json() as {
      success: boolean;
      data: { reminderSteps: unknown[]; reminderEnrollments?: Array<{ enrollmentId: string; versionNumber: number }> };
    };

    expect(response.status).toBe(200);
    // 現行の手順はBだけなので空のまま。旧版の登録が使用先に出る。
    expect(body.data.reminderSteps).toEqual([]);
    expect(body.data.reminderEnrollments ?? []).toMatchObject([{ enrollmentId: 'fr-active', versionNumber: 1 }]);
  });

  test('削除は409で止まり「○件の送信待ちの通知が使っています」と出す', async () => {
    await seedSwitchedRule();
    await seedEnrollment('fr-active', 'active');

    const first = await app().request('/api/templates/tpl-a', { method: 'DELETE' });
    const firstBody = await first.json() as { success: boolean; code: string; error: string };

    expect(first.status).toBe(409);
    expect(firstBody.code).toBe('IN_USE');
    expect(firstBody.error).toContain('送信待ちの通知1件');

    // 消えていないし、もう一度押しても同じく止まる（中途半端に消さない）。
    const row = await sqlite.db.prepare('SELECT id FROM templates WHERE id = ?').bind('tpl-a').first<{ id: string }>();
    expect(row?.id).toBe('tpl-a');
    const second = await app().request('/api/templates/tpl-a', { method: 'DELETE' });
    expect(second.status).toBe(409);
  });

  test('一覧の使用数にも旧版の登録が入る', async () => {
    await seedSwitchedRule();
    await seedEnrollment('fr-active', 'active');

    const { items } = await getTemplatesWithUsageCount(sqlite.db);
    expect(items.find((t) => t.id === 'tpl-a')?.usage_count).toBe(1);
  });

  test('終わった登録だけなら削除できる', async () => {
    await seedSwitchedRule();
    await seedEnrollment('fr-done', 'completed');

    const response = await app().request('/api/templates/tpl-a', { method: 'DELETE' });
    expect(response.status).toBe(200);
    const row = await sqlite.db.prepare('SELECT id FROM templates WHERE id = ?').bind('tpl-a').first();
    expect(row).toBeNull();
  });

  test('取消ずみ（再開できる）の登録も止める', async () => {
    await seedSwitchedRule();
    await seedEnrollment('fr-cancelled', 'cancelled');

    const response = await app().request('/api/templates/tpl-a', { method: 'DELETE' });
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toContain('送信待ちの通知');
  });
});
