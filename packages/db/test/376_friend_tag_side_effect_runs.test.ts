/*
 * migration 376: タグ付与の工程別台帳(#699)。
 *
 * schema.sql + migrations を順に当てた実 SQLite で、台帳の状態遷移・予約・
 * 「止まっている行」の判定を確かめる。
 */
import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
  FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM,
  FRIEND_TAG_SIDE_EFFECT_STEPS,
  canAutoRetryFriendTagSideEffect,
  claimFriendTagSideEffectRun,
  countStuckFriendTagSideEffectRuns,
  getFriendTagSideEffectRun,
  isFriendTagSideEffectStuck,
  listPendingFriendTagSideEffectRuns,
  listStuckFriendTagSideEffectRuns,
  listUnfinishedFriendTagSideEffectRuns,
  markFriendTagSideEffectCompleted,
  markFriendTagSideEffectFailed,
  openFriendTagSideEffectRuns,
  reopenFriendTagSideEffectRun,
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

const ASSIGNED_AT = '2026-09-11T10:00:00.000+09:00';

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
       VALUES ('friend-1', 'U-1', '田中さん', ?, ?)`,
    )
    .run(ASSIGNED_AT, ASSIGNED_AT);
  sqlite.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', '体験申込')`).run();
  // 台帳は friend_tags の付与に紐づく。運用の導線に出す行は、タグが付いている
  // ものだけなので、試験でも付与行を置く。
  sqlite
    .prepare(
      `INSERT INTO friend_tags (friend_id, tag_id, assigned_at) VALUES ('friend-1', 'tag-1', ?)`,
    )
    .run(ASSIGNED_AT);
  db = asD1(sqlite);
});

function run(stepKey: string): FriendTagSideEffectRun {
  return sqlite
    .prepare(
      `SELECT * FROM friend_tag_side_effect_runs
        WHERE friend_id = 'friend-1' AND tag_id = 'tag-1' AND step_key = ?`,
    )
    .get(stepKey) as FriendTagSideEffectRun;
}

async function open(): Promise<void> {
  await openFriendTagSideEffectRuns(db, {
    friendId: 'friend-1',
    tagId: 'tag-1',
    assignedAt: ASSIGNED_AT,
  });
}

describe('friend_tag_side_effect_runs', () => {
  test('付与のたびに工程を3本 pending で開き、工程の宣言順に返す', async () => {
    await open();
    const rows = await listUnfinishedFriendTagSideEffectRuns(db, 'friend-1', 'tag-1');
    // 初回と走り直しで順が逆転しないよう、宣言順で返す。
    expect(rows.map((r) => r.step_key)).toEqual([...FRIEND_TAG_SIDE_EFFECT_STEPS]);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.every((r) => r.assigned_at === ASSIGNED_AT)).toBe(true);
    expect(rows.every((r) => r.attempt_count === 0)).toBe(true);
  });

  test('済んだ工程は未了の一覧から外れ、落ちた工程は理由付きで残る', async () => {
    await open();
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe('claimed');
    await markFriendTagSideEffectCompleted(db, 'friend-1', 'tag-1', 'mileage');
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'scenario_enroll')).toBe(
      'claimed',
    );
    await markFriendTagSideEffectFailed(
      db,
      'friend-1',
      'tag-1',
      'scenario_enroll',
      new Error('enroll outage'),
    );

    const unfinished = await listUnfinishedFriendTagSideEffectRuns(db, 'friend-1', 'tag-1');
    expect(unfinished.map((r) => r.step_key)).toEqual(['scenario_enroll', 'event_tag_change']);
    expect(run('mileage').status).toBe('completed');
    expect(run('mileage').attempt_count).toBe(1);
    expect(run('scenario_enroll').status).toBe('failed');
    expect(run('scenario_enroll').last_error).toBe('Error: enroll outage');
    expect(run('scenario_enroll').last_attempt_at).not.toBeNull();
  });

  // ============================================================
  // 予約: 遷移条件と上限を1本の条件付き UPDATE で見る
  // ============================================================
  test('予約は1本しか取れない。2本目は走らせない', async () => {
    await open();
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change')).toBe(
      'claimed',
    );
    // running は event_tag_change の遷移元に無いので、2本目は取れない。
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change')).toBe(
      'not_claimable',
    );
    expect(run('event_tag_change').attempt_count).toBe(1);
  });

  test('冪等な工程でも、走っている最中の1本しか取れない', async () => {
    await open();
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe('claimed');
    // running は mileage の遷移元にあるので取れる。ただし取れるのは1本ずつで、
    // 取った側だけが走る(attempt_count が進むので上限で止まる)。
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe('claimed');
    expect(run('mileage').attempt_count).toBe(2);
  });

  test('済んだ工程は予約できない', async () => {
    await open();
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage');
    await markFriendTagSideEffectCompleted(db, 'friend-1', 'tag-1', 'mileage');
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe(
      'not_claimable',
    );
    expect(run('mileage').status).toBe('completed');
  });

  test('行が無いときは missing を返す(取れないこととは分ける)', async () => {
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe('missing');
    expect(await getFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBeNull();
  });

  test('上限に達した行は予約できない', async () => {
    await open();
    for (let i = 0; i < FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS; i += 1) {
      expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe('claimed');
      await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'mileage', 'boom');
    }
    expect(run('mileage').attempt_count).toBe(FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS);
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe(
      'not_claimable',
    );
  });

  // ============================================================
  // 走り直してよいかは status ではなく工程で決まる
  // ============================================================
  test('外へ出る工程は failed からも running からも予約できない', async () => {
    await open();
    for (const status of ['failed', 'running'] as const) {
      sqlite
        .prepare(
          `UPDATE friend_tag_side_effect_runs SET status = ?, attempt_count = 1
            WHERE step_key = 'event_tag_change'`,
        )
        .run(status);
      expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change')).toBe(
        'not_claimable',
      );
      expect(run('event_tag_change').attempt_count).toBe(1); // 進んでいない
    }
  });

  test('冪等な工程は failed からも running からも予約できる', async () => {
    await open();
    for (const step of ['mileage', 'scenario_enroll'] as const) {
      for (const status of ['failed', 'running'] as const) {
        sqlite
          .prepare(`UPDATE friend_tag_side_effect_runs SET status = ? WHERE step_key = ?`)
          .run(status, step);
        expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', step)).toBe('claimed');
      }
    }
  });

  test('遷移元の表と、ふるいの判定が食い違わない', () => {
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
    for (const step of FRIEND_TAG_SIDE_EFFECT_STEPS) {
      for (const status of ['pending', 'running', 'failed'] as const) {
        expect(canAutoRetryFriendTagSideEffect({ ...base, step_key: step, status })).toBe(
          FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM[step].includes(status),
        );
      }
      expect(canAutoRetryFriendTagSideEffect({ ...base, step_key: step, status: 'completed' })).toBe(
        false,
      );
      // 上限に達した行は、遷移元に入っていても走り直さない。
      expect(
        canAutoRetryFriendTagSideEffect({
          ...base,
          step_key: step,
          status: 'pending',
          attempt_count: FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
        }),
      ).toBe(false);
    }
    // 止まっている行 = 未了なのに自動では動かない。
    expect(isFriendTagSideEffectStuck({ ...base, step_key: 'event_tag_change' })).toBe(true);
    expect(isFriendTagSideEffectStuck({ ...base, step_key: 'scenario_enroll' })).toBe(false);
    expect(isFriendTagSideEffectStuck({ ...base, status: 'completed' })).toBe(false);
  });

  // ============================================================
  // 止まっている行を問える口
  // ============================================================
  test('「いま止まっているものはあるか」を一問で数えられる', async () => {
    await open();
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(0);

    // 冪等な工程が1回落ちただけなら、まだ自動で走り直す = 止まっていない。
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'scenario_enroll');
    await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'scenario_enroll', 'boom');
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(0);

    // 外へ出る工程が落ちたら、自動では動かない = 止まっている。
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change');
    await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'event_tag_change', 'boom');
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(1);

    const stuck = await listStuckFriendTagSideEffectRuns(db, { limit: 10 });
    expect(stuck.map((r) => r.step_key)).toEqual(['event_tag_change']);
    expect(stuck[0].last_error).toBe('boom');

    // 上限に達した冪等な工程も、止まっている行。
    sqlite
      .prepare(
        `UPDATE friend_tag_side_effect_runs SET attempt_count = ? WHERE step_key = 'scenario_enroll'`,
      )
      .run(FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS);
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(2);
  });

  test('タグが外れた行は、未了の一覧にも止まっている行にも出さない', async () => {
    await open();
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change');
    await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'event_tag_change', 'boom');
    expect((await listPendingFriendTagSideEffectRuns(db)).length).toBe(3);
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(1);

    sqlite.prepare(`DELETE FROM friend_tags WHERE friend_id = 'friend-1'`).run();
    expect(await listPendingFriendTagSideEffectRuns(db)).toEqual([]);
    expect(await listStuckFriendTagSideEffectRuns(db)).toEqual([]);
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(0);
  });

  // ============================================================
  // 人が使う口
  // ============================================================
  test('reopen は試行回数と理由を残したまま pending へ戻す', async () => {
    await open();
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change');
    await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'event_tag_change', 'boom');

    expect(await reopenFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change')).toBe(
      true,
    );
    const row = run('event_tag_change');
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(1); // 上限は効いたまま
    expect(row.last_error).toBe('boom'); // 履歴も残る
    // pending からは予約できる = 人の判断で走り直せる。
    expect(await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change')).toBe(
      'claimed',
    );
  });

  test('reopen は済んだ工程を戻さない', async () => {
    await open();
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage');
    await markFriendTagSideEffectCompleted(db, 'friend-1', 'tag-1', 'mileage');
    expect(await reopenFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'mileage')).toBe(false);
    expect(run('mileage').status).toBe('completed');
  });

  test('付け直しは同じ行を新しい付与時刻で pending へ戻す', async () => {
    await open();
    await claimFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'scenario_enroll');
    await markFriendTagSideEffectFailed(db, 'friend-1', 'tag-1', 'scenario_enroll', 'boom');

    const next = '2026-09-12T09:00:00.000+09:00';
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
