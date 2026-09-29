import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { unlinkMergedPersonFriend } from '../services/merged-people.js';
import { friendMigrations } from './friend-migrations.js';
import { mergedPeople } from './merged-people.js';

/*
 * 監査 R391・R395・R396（UID移行の競合・保管履歴）の回帰試験。
 * モックではなく本物の SQLite に実ルートを載せ、監査の再現手順をなぞる。
 * 同時実行の割り込みは、確認読みと書込みの間に別担当の操作を差し込む。
 * 直しを戻すと赤くなることを確認済み。
 */

const executor: AuthenticatedStaff = {
  id: 'owner-2', name: '別担当', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID,
};

/** サービス呼び出し用の担当（tenantId 必須）。 */
const serviceActor = { id: 'owner-2', name: '別担当', tenantId: DEFAULT_TENANT_ID };

function appFor(db: D1Database, staff: AuthenticatedStaff) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', staff);
    await next();
  });
  app.route('/', friendMigrations);
  app.route('/', mergedPeople);
  return app;
}

function envFor(db: D1Database) {
  return { DB: db };
}

function post(path: string) {
  return new Request(`https://example.com${path}`, { method: 'POST' });
}

function seedMigrationRun(testDb: SqliteD1, status = 'ready'): void {
  const { raw } = testDb;
  for (const [id, name] of [['acc-from', '移行元'], ['acc-to', '移行先']]) {
    raw.prepare(`
      INSERT INTO line_accounts (
        id, channel_id, name, channel_access_token, channel_secret, tenant_id
      ) VALUES (?, ?, ?, 'token', 'secret', ?)
    `).run(id, `channel-${id}`, name, DEFAULT_TENANT_ID);
  }
  insertFriend(raw, 'f-old', {
    line_account_id: 'acc-from', line_user_id: 'UOLD-1', display_name: '旧友だち', user_id: null,
  });
  insertFriend(raw, 'f-new', {
    line_account_id: 'acc-to', line_user_id: 'UNEW-1', display_name: '新友だち', user_id: null,
  });
  raw.prepare(`
    INSERT INTO users (
      id, tenant_id, status, display_name, revision, created_by, created_at, updated_at
    ) VALUES ('user-u2', ?, 'active', '別の本人', 1, 'owner-1',
      '2026-08-30T09:00:00.000Z', '2026-08-30T09:00:00.000Z')
  `).run(DEFAULT_TENANT_ID);
  raw.prepare(`
    INSERT INTO uid_migration_runs (
      id, from_account_id, to_account_id, purpose, source_kind, source_filename,
      status, dry_run_revision, total_count, auto_count, review_count,
      unmatched_count, conflict_count, applied_count, failed_count,
      created_by, created_at
    ) VALUES ('run-1', 'acc-from', 'acc-to', '移行A', 'csv', 'map.csv',
      ?, 1, 1, 1, 0, 0, 0, 0, 0, 'owner-1', '2026-08-30T09:00:00.000Z')
  `).run(status);
  raw.prepare(`
    INSERT INTO uid_migration_items (
      id, run_id, old_uid, new_uid, old_friend_id, new_friend_id,
      evidence_type, evidence_json, classification, decision, result,
      created_at, updated_at
    ) VALUES ('item-1', 'run-1', 'UOLD-1', 'UNEW-1', 'f-old', 'f-new',
      'operator_csv', '{}', 'auto', 'link', 'pending',
      '2026-08-30T09:00:00.000Z', '2026-08-30T09:00:00.000Z')
  `).run();
}

/*
 * 対応表の確認読み（SELECT ... friends ... WHERE id IN）の直後に
 * 別担当の再連携を差し込む。確認時と書込時で現在値がずれる競合を再現する。
 */
function raceOnPairPrecheck(db: D1Database, raw: SqliteD1['raw'], moveSql: string): D1Database {
  let armed = true;
  const prepare = (sql: string) => {
    const statement = db.prepare(sql);
    return {
      ...statement,
      bind: (...args: unknown[]) => {
        const bound = (statement as unknown as { bind: (...a: unknown[]) => D1PreparedStatement }).bind(...args);
        if (!armed || !/FROM friends/i.test(sql) || !/WHERE id IN/i.test(sql)) return bound;
        return {
          ...bound,
          all: (async () => {
            const result = await bound.all();
            armed = false;
            raw.exec(moveSql);
            return result;
          }) as D1PreparedStatement['all'],
        };
      },
    };
  };
  return { ...db, prepare } as unknown as D1Database;
}

function friendUserId(testDb: SqliteD1, id: string): string | null {
  return (testDb.raw.prepare('SELECT user_id FROM friends WHERE id = ?').get(id) as { user_id: string | null }).user_id ?? null;
}

function migrationItem(testDb: SqliteD1) {
  return testDb.raw.prepare('SELECT * FROM uid_migration_items WHERE id = ?').get('item-1') as {
    result: string; error_message: string | null; before_json: string | null; after_json: string | null;
  };
}

describe('R395 確認後の再連携を本移行で上書きしない', () => {
  it('競合した行は失敗に記録し、再連携先を残す', async () => {
    const testDb = createTestD1();
    seedMigrationRun(testDb);
    const racyDb = raceOnPairPrecheck(
      testDb.db, testDb.raw, `UPDATE friends SET user_id = 'user-u2' WHERE id = 'f-old'`,
    );
    const response = await appFor(racyDb, executor).fetch(post('/api/friends/migrations/run-1/execute'), envFor(racyDb));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { status: 'failed' } });
    // 再連携先は上書きされない。
    expect(friendUserId(testDb, 'f-old')).toBe('user-u2');
    expect(friendUserId(testDb, 'f-new')).toBeNull();
    // 競合として記録され、before/after は書かれない（何も変えていないため）。
    const item = migrationItem(testDb);
    expect(item.result).toBe('failed');
    expect(item.error_message).toContain('結び付きが変わりました');
    expect(item.before_json).toBeNull();
    expect(item.after_json).toBeNull();
  });

  it('競合がなければ本移行が通り、before_jsonは書込時の現在値になる', async () => {
    const testDb = createTestD1();
    seedMigrationRun(testDb);
    const response = await appFor(testDb.db, executor).fetch(
      post('/api/friends/migrations/run-1/execute'), envFor(testDb.db),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { status: 'completed' } });
    const userId = friendUserId(testDb, 'f-old');
    expect(userId).not.toBeNull();
    expect(friendUserId(testDb, 'f-new')).toBe(userId);
    const item = migrationItem(testDb);
    expect(item.result).toBe('applied');
    expect(JSON.parse(item.before_json!)).toEqual({ oldUserId: null, newUserId: null });
    expect(JSON.parse(item.after_json!)).toEqual({ userId });
  });
});

describe('R396 切り戻しの遅い競合はペア全体を変えない', () => {
  function seedApplied(testDb: SqliteD1): void {
    seedMigrationRun(testDb, 'completed');
    testDb.raw.prepare(`UPDATE users SET revision = 1 WHERE id = 'user-u2'`).run();
    testDb.raw.prepare(`
      INSERT INTO users (
        id, tenant_id, status, display_name, revision, created_by, created_at, updated_at
      ) VALUES ('user-u1', ?, 'active', '移行先の本人', 2, 'owner-2',
        '2026-08-30T09:00:00.000Z', '2026-08-30T09:00:00.000Z')
    `).run(DEFAULT_TENANT_ID);
    testDb.raw.prepare(`UPDATE friends SET user_id = 'user-u1' WHERE id IN ('f-old', 'f-new')`).run();
    testDb.raw.prepare(`
      UPDATE uid_migration_runs SET applied_count = 1 WHERE id = 'run-1'
    `).run();
    testDb.raw.prepare(`
      UPDATE uid_migration_items
        SET result = 'applied',
            before_json = '{"oldUserId":null,"newUserId":null}',
            after_json = '{"userId":"user-u1"}'
        WHERE id = 'item-1'
    `).run();
  }

  it('片方だけ戻さず、再試行できる状態で409になる', async () => {
    const testDb = createTestD1();
    seedApplied(testDb);
    const racyDb = raceOnPairPrecheck(
      testDb.db, testDb.raw, `UPDATE friends SET user_id = 'user-u2' WHERE id = 'f-old'`,
    );
    const conflicted = await appFor(racyDb, executor).fetch(
      post('/api/friends/migrations/run-1/rollback'), envFor(racyDb),
    );
    expect(conflicted.status).toBe(409);
    // ペア全体が変わらない（片方だけ戻らない）。
    expect(friendUserId(testDb, 'f-old')).toBe('user-u2');
    expect(friendUserId(testDb, 'f-new')).toBe('user-u1');
    const item = migrationItem(testDb);
    expect(item.result).toBe('applied');
    // 外の変更を戻せば再試行できる。
    testDb.raw.prepare(`UPDATE friends SET user_id = 'user-u1' WHERE id = 'f-old'`).run();
    const retried = await appFor(testDb.db, executor).fetch(
      post('/api/friends/migrations/run-1/rollback'), envFor(testDb.db),
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ success: true, data: { rolledBack: 1 } });
    expect(friendUserId(testDb, 'f-old')).toBeNull();
    expect(friendUserId(testDb, 'f-new')).toBeNull();
    expect(migrationItem(testDb).result).toBe('rolled_back');
  });

  it('競合がなければ切り戻しが通る', async () => {
    const testDb = createTestD1();
    seedApplied(testDb);
    const response = await appFor(testDb.db, executor).fetch(
      post('/api/friends/migrations/run-1/rollback'), envFor(testDb.db),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { rolledBack: 1 } });
  });
});

describe('R391 保管状態の本人は詳細と履歴を開ける', () => {
  function seedPerson(testDb: SqliteD1): void {
    const { raw } = testDb;
    for (const [id, name] of [['account-a', '本店'], ['account-b', '支店']]) {
      raw.prepare(`
        INSERT INTO line_accounts (
          id, channel_id, name, channel_access_token, channel_secret, tenant_id
        ) VALUES (?, ?, ?, 'token', 'secret', ?)
      `).run(id, `channel-${id}`, name, DEFAULT_TENANT_ID);
    }
    insertFriend(raw, 'friend-a', {
      line_account_id: 'account-a', display_name: '田中 花子', user_id: 'user-a',
    });
    insertFriend(raw, 'friend-b', {
      line_account_id: 'account-b', display_name: '田中 はなこ', user_id: 'user-a',
    });
    // R391の被害形: 本人は統括を持たない行（移行・判定で作られる形）。
    raw.prepare(`
      INSERT INTO users (
        id, tenant_id, status, display_name, primary_display_name, revision,
        created_by, created_at, updated_at
      ) VALUES ('user-a', NULL, 'active', '田中 花子', '田中 花子', 1,
        'owner-1', '2026-08-30T09:00:00.000Z', '2026-08-30T09:00:00.000Z')
    `).run();
    raw.prepare(`
      INSERT INTO identity_candidates (
        id, tenant_id, kind, status, version, confidence_score, detector_version,
        left_subject_kind, left_subject_id, left_line_account_id, left_snapshot_json,
        right_subject_kind, right_subject_id, right_line_account_id, right_snapshot_json,
        evidence_fingerprint, evidence_json, impact_json, detected_at, reviewed_at,
        created_at, updated_at
      ) VALUES ('candidate-a', ?, 'friend_duplicate', 'linked', 2, 92, 'v1',
        'friend', 'friend-a', 'account-a', '{}', 'friend', 'friend-b', 'account-b',
        '{}', 'fingerprint-a', '[]', '[]', '2026-08-30T09:00:00.000Z',
        '2026-08-30T09:10:00.000Z', '2026-08-30T09:00:00.000Z',
        '2026-08-30T09:10:00.000Z')
    `).run(DEFAULT_TENANT_ID);
    for (const [id, friendId] of [['link-a', 'friend-a'], ['link-b', 'friend-b']]) {
      raw.prepare(`
        INSERT INTO friend_identity_links (
          id, tenant_id, candidate_id, user_id, friend_id, link_method,
          evidence_snapshot_json, confidence_score, linked_by, linked_at
        ) VALUES (?, ?, 'candidate-a', 'user-a', ?, 'operator_review', '[]', 92,
          'owner-1', '2026-08-30T09:10:00.000Z')
      `).run(id, DEFAULT_TENANT_ID, friendId);
    }
  }

  it('統括全体のownerは最後の解除後も詳細と履歴を見られる', async () => {
    const testDb = createTestD1();
    seedPerson(testDb);
    await unlinkMergedPersonFriend(testDb.db, serviceActor, 'user-a', 'friend-a', {
      expectedRevision: 1, reason: '本店の結び付きを解除します',
    });
    await unlinkMergedPersonFriend(testDb.db, serviceActor, 'user-a', 'friend-b', {
      expectedRevision: 2, reason: '支店の結び付きを解除します',
    });
    const response = await appFor(testDb.db, executor).fetch(
      new Request('https://example.com/api/friends/people/user-a'), envFor(testDb.db),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean; data: { linkedFriends: unknown[]; history: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.linkedFriends).toEqual([]);
    expect(body.data.history.length).toBeGreaterThanOrEqual(2);
  });

  it('担当店だけの管理者には保管履歴を開示しない', async () => {
    const testDb = createTestD1();
    seedPerson(testDb);
    await unlinkMergedPersonFriend(testDb.db, serviceActor, 'user-a', 'friend-a', {
      expectedRevision: 1, reason: '本店の結び付きを解除します',
    });
    await unlinkMergedPersonFriend(testDb.db, serviceActor, 'user-a', 'friend-b', {
      expectedRevision: 2, reason: '支店の結び付きを解除します',
    });
    testDb.raw.prepare(`
      INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
      VALUES ('admin-a', '本店だけの管理者', 'admin', 'key-admin-a', ?, 'accounts')
    `).run(DEFAULT_TENANT_ID);
    testDb.raw.prepare(`
      INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
      VALUES ('admin-a', 'account-a', '2026-08-30T09:00:00.000Z')
    `).run();
    const scoped: AuthenticatedStaff = {
      id: 'admin-a', name: '本店だけの管理者', role: 'admin', readOnly: false, tenantId: DEFAULT_TENANT_ID,
    };
    const response = await appFor(testDb.db, scoped).fetch(
      new Request('https://example.com/api/friends/people/user-a'), envFor(testDb.db),
    );
    expect(response.status).toBe(403);
  });
});
