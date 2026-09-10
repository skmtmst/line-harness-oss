/*
 * migration 376: タグ付与の工程別台帳(#699)。
 *
 * schema.sql + migrations を順に当てた実 SQLite で、台帳の状態遷移と
 * 走り直しの判断を確かめる。
 */
import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
  FRIEND_TAG_SIDE_EFFECT_STEPS,
  isFriendTagSideEffectRetryable,
  listPendingFriendTagSideEffectRuns,
  listUnfinishedFriendTagSideEffectRuns,
  markFriendTagSideEffectCompleted,
  markFriendTagSideEffectFailed,
  markFriendTagSideEffectRunning,
  openFriendTagSideEffectRuns,
  type FriendTagSideEffectRun,
} from '../src/friend-tag-side-effects.js';
import { asD1 } from './d1-test-helper.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const benign = /duplicate column name|already exists/i;

function execSafe(sqlite: Database.Database, sql: string): void {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((v) => v.trim()).filter(Boolean)) {
    try {
      sqlite.exec(statement);
    } catch (error) {
      if (!benign.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  execSafe(sqlite, readFileSync(join(root, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    execSafe(sqlite, readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES ('friend-1', 'U-1', '田中さん', '2026-09-10T10:00:00.000+09:00',
               '2026-09-10T10:00:00.000+09:00')`,
    )
    .run();
  sqlite.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', '体験申込')`).run();
  db = asD1(sqlite);
});

const ASSIGNED_AT = '2026-09-10T10:00:00.000+09:00';

function run(stepKey: string): FriendTagSideEffectRun {
  return sqlite
    .prepare(
      `SELECT * FROM friend_tag_side_effect_runs
        WHERE friend_id = 'friend-1' AND tag_id = 'tag-1' AND step_key = ?`,
    )
    .get(stepKey) as FriendTagSideEffectRun;
}

describe('friend_tag_side_effect_runs', () => {
  test('付与のたびに工程を3本 pending で開く', async () => {
    await openFriendTagSideEffectRuns(db, {
      friendId: 'friend-1',
      tagId: 'tag-1',
      assignedAt: ASSIGNED_AT,
    });
    const rows = await listUnfinishedFriendTagSideEffectRuns(db, 'friend-1', 'tag-1');
    expect(rows.map((r) => r.step_key).sort()).toEqual([...FRIEND_TAG_SIDE_EFFECT_STEPS].sort());
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.every((r) => r.assigned_at === ASSIGNED_AT)).toBe(true);
    expect(rows.every((r) => r.attempt_count === 0)).toBe(true);
  });

  test('済んだ工程は未了の一覧から外れ、落ちた工程は理由付きで残る', async () => {
    await openFriendTagSideEffectRuns(db, {
      friendId: 'friend-1',
      tagId: 'tag-1',
      assignedAt: ASSIGNED_AT,
    });
    await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', 'mileage');
    await markFriendTagSideEffectCompleted(db, 'friend-1', 'tag-1', 'mileage');
    await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', 'scenario_enroll');
    await markFriendTagSideEffectFailed(
      db,
      'friend-1',
      'tag-1',
      'scenario_enroll',
      new Error('enroll outage'),
    );

    const unfinished = await listUnfinishedFriendTagSideEffectRuns(db, 'friend-1', 'tag-1');
    expect(unfinished.map((r) => r.step_key)).toEqual(['event_tag_change', 'scenario_enroll']);
    expect(run('mileage').status).toBe('completed');
    expect(run('mileage').attempt_count).toBe(1);
    expect(run('scenario_enroll').status).toBe('failed');
    expect(run('scenario_enroll').last_error).toBe('Error: enroll outage');
    expect(run('scenario_enroll').last_attempt_at).not.toBeNull();
  });

  test('済んだ工程は、もう一度 running を立てても動かない', async () => {
    await openFriendTagSideEffectRuns(db, {
      friendId: 'friend-1',
      tagId: 'tag-1',
      assignedAt: ASSIGNED_AT,
    });
    await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', 'event_tag_change');
    await markFriendTagSideEffectCompleted(db, 'friend-1', 'tag-1', 'event_tag_change');
    await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', 'event_tag_change');
    expect(run('event_tag_change').status).toBe('completed');
    expect(run('event_tag_change').attempt_count).toBe(1);
  });

  test('付け直しは同じ行を新しい付与時刻で pending へ戻す', async () => {
    await openFriendTagSideEffectRuns(db, {
      friendId: 'friend-1',
      tagId: 'tag-1',
      assignedAt: ASSIGNED_AT,
    });
    await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', 'scenario_enroll');
    await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'scenario_enroll', 'boom');

    const next = '2026-09-11T09:00:00.000+09:00';
    await openFriendTagSideEffectRuns(db, {
      friendId: 'friend-1',
      tagId: 'tag-1',
      assignedAt: next,
    });
    const row = run('scenario_enroll');
    expect(row.status).toBe('pending');
    expect(row.assigned_at).toBe(next);
    expect(row.attempt_count).toBe(0);
    expect(row.last_error).toBeNull();
    // 行が増えず、同じ主キーを使い回していること。
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS c FROM friend_tag_side_effect_runs`).get() as { c: number }).c,
    ).toBe(3);
  });

  test('走り直してよいかの判断: 上限と、結末が分からない行の扱い', () => {
    const base: FriendTagSideEffectRun = {
      friend_id: 'friend-1',
      tag_id: 'tag-1',
      step_key: 'scenario_enroll',
      assigned_at: ASSIGNED_AT,
      status: 'failed',
      attempt_count: 1,
      last_error: 'boom',
      last_attempt_at: ASSIGNED_AT,
      created_at: ASSIGNED_AT,
      updated_at: ASSIGNED_AT,
    };
    expect(isFriendTagSideEffectRetryable(base)).toBe(true);
    expect(isFriendTagSideEffectRetryable({ ...base, status: 'pending' })).toBe(true);
    expect(isFriendTagSideEffectRetryable({ ...base, status: 'completed' })).toBe(false);
    // 上限に達した行は触らない。
    expect(
      isFriendTagSideEffectRetryable({
        ...base,
        attempt_count: FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
      }),
    ).toBe(false);
    // 結末が分からない行: 冪等な工程だけ走り直す。
    expect(isFriendTagSideEffectRetryable({ ...base, status: 'running' })).toBe(true);
    expect(
      isFriendTagSideEffectRetryable({ ...base, status: 'running', step_key: 'mileage' }),
    ).toBe(true);
    expect(
      isFriendTagSideEffectRetryable({ ...base, status: 'running', step_key: 'event_tag_change' }),
    ).toBe(false);
  });

  test('運用の確認用に、未了の工程を古い順に引ける', async () => {
    await openFriendTagSideEffectRuns(db, {
      friendId: 'friend-1',
      tagId: 'tag-1',
      assignedAt: ASSIGNED_AT,
    });
    for (const step of FRIEND_TAG_SIDE_EFFECT_STEPS) {
      await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', step);
      await markFriendTagSideEffectCompleted(db, 'friend-1', 'tag-1', step);
    }
    expect(await listPendingFriendTagSideEffectRuns(db)).toEqual([]);

    await markFriendTagSideEffectRunning(db, 'friend-1', 'tag-1', 'scenario_enroll');
    // completed は running へ落ちないので、落ちた印を直接立てて確かめる。
    sqlite
      .prepare(
        `UPDATE friend_tag_side_effect_runs SET status = 'failed', last_error = 'boom'
          WHERE step_key = 'scenario_enroll'`,
      )
      .run();
    const pending = await listPendingFriendTagSideEffectRuns(db, { limit: 10 });
    expect(pending.map((r) => r.step_key)).toEqual(['scenario_enroll']);
    expect(pending[0].last_error).toBe('boom');
  });

  test('step_key と status は検査で縛られている', () => {
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO friend_tag_side_effect_runs
             (friend_id, tag_id, step_key, assigned_at, created_at, updated_at)
           VALUES ('friend-1', 'tag-1', 'unknown_step', ?, ?, ?)`,
        )
        .run(ASSIGNED_AT, ASSIGNED_AT, ASSIGNED_AT),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO friend_tag_side_effect_runs
             (friend_id, tag_id, step_key, assigned_at, status, created_at, updated_at)
           VALUES ('friend-1', 'tag-1', 'mileage', ?, 'whatever', ?, ?)`,
        )
        .run(ASSIGNED_AT, ASSIGNED_AT, ASSIGNED_AT),
    ).toThrow(/CHECK constraint failed/);
  });
});
