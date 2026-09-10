/*
 * #699: タグ付与後の副作用が1度落ちると二度と走らない欠陥の回帰試験。
 *
 * 実DB相当 (better-sqlite3 + bootstrap.sql) で、本物の
 * enqueueMileageEvent / enrollFriendInScenario / fireEvent を走らせる。
 * 障害は module のモックではなく DB 側の TRIGGER で起こすので、
 * 「本当にその経路が落ちたときどうなるか」を見ている。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS, enrollFriendInScenario } from '@line-crm/db';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  attachTagAndFireSideEffects,
  retryFriendTagSideEffects,
} from './friend-tag-attach.js';
import { fireEvent } from './event-bus.js';

function setup() {
  const { db, raw } = createTestD1();
  insertFriend(raw, 'friend-1');
  raw.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', '体験申込')`).run();
  raw
    .prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, allow_concurrent)
       VALUES ('scenario-1', 'タグ起点の案内', 'tag_added', 1, 1)`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
       VALUES ('step-1', 'scenario-1', 0, 60, 'text', 'こんにちは')`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO scenario_triggers (id, scenario_id, kind, tag_id)
       VALUES ('trigger-1', 'scenario-1', 'tag_added', 'tag-1')`,
    )
    .run();
  // fireEvent('tag_change') が走ったかを DB で観測するための加点ルール。
  // 加点は冪等でないので、2回走れば2行増える = 二重発火が見える。
  raw
    .prepare(
      `INSERT INTO scoring_rules (id, name, event_type, score_value)
       VALUES ('rule-1', 'タグ変化', 'tag_change', 5)`,
    )
    .run();
  return { db, raw };
}

function counts(raw: Database.Database) {
  const one = (sql: string) => (raw.prepare(sql).get() as { c: number }).c;
  return {
    friendTags: one(`SELECT COUNT(*) AS c FROM friend_tags WHERE friend_id = 'friend-1'`),
    enrollments: one(`SELECT COUNT(*) AS c FROM friend_scenarios WHERE friend_id = 'friend-1'`),
    tagChangeScores: one(`SELECT COUNT(*) AS c FROM friend_scores WHERE friend_id = 'friend-1'`),
    mileageEvents: one(`SELECT COUNT(*) AS c FROM engagement_events WHERE event_type = 'tag_added'`),
  };
}

function ledger(raw: Database.Database) {
  return raw
    .prepare(
      `SELECT step_key, status, attempt_count, assigned_at, last_error
         FROM friend_tag_side_effect_runs
        WHERE friend_id = 'friend-1' AND tag_id = 'tag-1'
        ORDER BY step_key ASC`,
    )
    .all() as {
      step_key: string;
      status: string;
      attempt_count: number;
      assigned_at: string;
      last_error: string | null;
    }[];
}

function ledgerStatuses(raw: Database.Database): Record<string, string> {
  return Object.fromEntries(ledger(raw).map((row) => [row.step_key, row.status]));
}

/** friend_scenarios への INSERT を DB が拒む状態を作る。 */
function startEnrollOutage(raw: Database.Database): void {
  raw.exec(
    `CREATE TRIGGER t_enroll_outage BEFORE INSERT ON friend_scenarios
     BEGIN SELECT RAISE(ABORT, 'enroll outage'); END`,
  );
}

function endEnrollOutage(raw: Database.Database): void {
  raw.exec(`DROP TRIGGER t_enroll_outage`);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('#699 タグ付与後の副作用の工程別台帳', () => {
  test('付与だけ確定して工程が落ちた事実が台帳に残り、失敗理由も残る', async () => {
    const { db, raw } = setup();
    startEnrollOutage(raw);

    await expect(attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).rejects.toThrow(
      /enroll outage/,
    );

    expect(counts(raw).friendTags).toBe(1); // 付与は確定している
    const rows = ledger(raw);
    expect(rows.map((r) => r.step_key)).toEqual([
      'event_tag_change',
      'mileage',
      'scenario_enroll',
    ]);
    const byStep = Object.fromEntries(rows.map((r) => [r.step_key, r]));
    expect(byStep.scenario_enroll.status).toBe('failed');
    expect(byStep.scenario_enroll.last_error).toMatch(/enroll outage/);
    // 落ちたのはシナリオ登録だけ。ほかの工程は巻き添えにせず済ませる。
    expect(byStep.mileage.status).toBe('completed');
    expect(byStep.event_tag_change.status).toBe('completed');

    // 握り潰されていない: 呼び出し口へ投げ直したうえで、記録も出している。
    expect(
      errorSpy.mock.calls.some((call) => String(call[0]).includes('step=scenario_enroll')),
    ).toBe(true);
  });

  test('次に同じ経路へ来たとき、落ちた工程だけが走り直る', async () => {
    const { db, raw } = setup();
    startEnrollOutage(raw);
    await expect(attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).rejects.toThrow();
    const afterFailure = counts(raw);
    expect(afterFailure.enrollments).toBe(0);
    expect(afterFailure.tagChangeScores).toBe(1);
    expect(afterFailure.mileageEvents).toBe(1);

    endEnrollOutage(raw);

    // 同じ経路をもう一度通す。付与は済んでいるので changes=0 の側へ入る。
    const second = await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    expect(second).toEqual({ added: false });

    const afterRetry = counts(raw);
    expect(afterRetry.enrollments).toBe(1); // 落ちた工程は走り直った
    expect(afterRetry.tagChangeScores).toBe(1); // 済んだ工程は走り直さない
    expect(afterRetry.mileageEvents).toBe(1);
    expect(ledgerStatuses(raw)).toEqual({
      mileage: 'completed',
      scenario_enroll: 'completed',
      event_tag_change: 'completed',
    });
  });

  test('走り直しは付与時刻を台帳から取り直すので、マイルが二重に積まれない', async () => {
    const { db, raw } = setup();
    startEnrollOutage(raw);
    await expect(attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).rejects.toThrow();
    const assignedAt = ledger(raw)[0].assigned_at;
    expect(assignedAt).toBe(
      (raw.prepare(`SELECT assigned_at FROM friend_tags WHERE friend_id = 'friend-1'`).get() as {
        assigned_at: string;
      }).assigned_at,
    );

    // マイルの工程も未了へ戻し、走り直しでキーが変わらないことを見る。
    raw
      .prepare(
        `UPDATE friend_tag_side_effect_runs SET status = 'failed'
          WHERE friend_id = 'friend-1' AND tag_id = 'tag-1' AND step_key = 'mileage'`,
      )
      .run();
    endEnrollOutage(raw);

    await retryFriendTagSideEffects(db, 'friend-1', 'tag-1');
    expect(counts(raw).mileageEvents).toBe(1);
    expect(ledgerStatuses(raw).mileage).toBe('completed');
  });

  test('正常な経路を2回通しても、どの副作用も二重に走らない', async () => {
    const { db, raw } = setup();
    expect(await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).toEqual({ added: true });
    expect(await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).toEqual({ added: false });
    expect(counts(raw)).toEqual({
      friendTags: 1,
      enrollments: 1,
      tagChangeScores: 1,
      mileageEvents: 1,
    });
  });

  test('enrollFriendInScenario は2回走らせても増えないが、fireEvent は増える', async () => {
    const { db, raw } = setup();
    // enrollFriendInScenario: 存在確認と部分UNIQUE索引で二重登録を防ぐ。
    await enrollFriendInScenario(db, 'friend-1', 'scenario-1');
    await enrollFriendInScenario(db, 'friend-1', 'scenario-1');
    expect(counts(raw).enrollments).toBe(1);

    // fireEvent は冪等でない。だから「二重に走らせない」責任は台帳側にある。
    await fireEvent(db, 'tag_change', {
      friendId: 'friend-1',
      eventData: { tagId: 'tag-1', action: 'add' },
    });
    await fireEvent(db, 'tag_change', {
      friendId: 'friend-1',
      eventData: { tagId: 'tag-1', action: 'add' },
    });
    expect(counts(raw).tagChangeScores).toBe(2);
  });

  test('結末が分からない工程は、冪等なものだけ走り直す', async () => {
    const { db, raw } = setup();
    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    // 処理ごと消えて running のまま残った、という状態を作る。
    raw
      .prepare(
        `UPDATE friend_tag_side_effect_runs SET status = 'running', attempt_count = 1
          WHERE friend_id = 'friend-1' AND tag_id = 'tag-1'`,
      )
      .run();
    raw.prepare(`DELETE FROM friend_scenarios WHERE friend_id = 'friend-1'`).run();

    const result = await retryFriendTagSideEffects(db, 'friend-1', 'tag-1');
    expect(result).toEqual({ retried: 2, failed: 0 });

    const after = counts(raw);
    expect(after.enrollments).toBe(1); // 冪等な工程は走り直った
    expect(after.mileageEvents).toBe(1);
    expect(after.tagChangeScores).toBe(1); // 冪等でない tag_change は走らせない
    expect(ledgerStatuses(raw).event_tag_change).toBe('running'); // 人が見る印として残る
  });

  test('落ち続ける工程は上限で止まり、台帳に残る', async () => {
    const { db, raw } = setup();
    startEnrollOutage(raw);
    await expect(attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).rejects.toThrow();

    for (let i = 0; i < FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS + 2; i += 1) {
      await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    }
    const row = ledger(raw).find((r) => r.step_key === 'scenario_enroll')!;
    expect(row.status).toBe('failed');
    expect(row.attempt_count).toBe(FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS);
    expect(row.last_error).toMatch(/enroll outage/);
  });

  test('タグを外して付け直すと、工程は新しい付与としてすべて開き直る', async () => {
    const { db, raw } = setup();
    await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    const firstAssignedAt = ledger(raw)[0].assigned_at;

    raw.prepare(`DELETE FROM friend_tags WHERE friend_id = 'friend-1'`).run();
    raw.prepare(`DELETE FROM friend_scenarios WHERE friend_id = 'friend-1'`).run();

    expect(await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).toEqual({ added: true });
    const rows = ledger(raw);
    expect(rows.every((r) => r.status === 'completed')).toBe(true);
    expect(rows.every((r) => r.assigned_at !== firstAssignedAt)).toBe(true);
    expect(counts(raw).enrollments).toBe(1);
    expect(counts(raw).tagChangeScores).toBe(2); // 新しい出来事なので、もう一度発火する
  });

  test('台帳が無い古い付与は、勝手に走り直さない', async () => {
    const { db, raw } = setup();
    // 376 より前に付いたタグ = friend_tags はあるが台帳の行が無い。
    raw
      .prepare(
        `INSERT INTO friend_tags (friend_id, tag_id, assigned_at)
         VALUES ('friend-1', 'tag-1', '2026-01-01T00:00:00.000+09:00')`,
      )
      .run();

    expect(await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).toEqual({ added: false });
    expect(counts(raw)).toEqual({
      friendTags: 1,
      enrollments: 0,
      tagChangeScores: 0,
      mileageEvents: 0,
    });
    expect(ledger(raw)).toEqual([]);
  });
});
