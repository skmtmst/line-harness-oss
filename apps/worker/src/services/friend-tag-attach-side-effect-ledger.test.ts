/*
 * #699: タグ付与後の副作用が1度落ちると二度と走らない欠陥の回帰試験。
 *
 * 実DB相当 (better-sqlite3 + bootstrap.sql) で、本物の
 * enqueueMileageEvent / enrollFriendInScenario / fireEvent を走らせる。
 * 障害は module のモックではなく、DB 側の TRIGGER か D1 の殻の層で起こす。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type Database from 'better-sqlite3';
import {
  FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
  countStuckFriendTagSideEffectRuns,
  enrollFriendInScenario,
  listStuckFriendTagSideEffectRuns,
  reopenFriendTagSideEffectRun,
} from '@line-crm/db';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  attachTagAndFireSideEffects,
  retryFriendTagSideEffects,
} from './friend-tag-attach.js';
import { fireEvent } from './event-bus.js';

function setup() {
  const { db, raw } = createTestD1();
  raw
    .prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '本店', 'token', 'secret')`,
    )
    .run();
  insertFriend(raw, 'friend-1', { line_account_id: 'account-1' });
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

function totalScore(raw: Database.Database): number {
  return (
    raw.prepare(`SELECT score FROM friends WHERE id = 'friend-1'`).get() as { score: number }
  ).score;
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

function stuckNotices(raw: Database.Database) {
  return raw
    .prepare(
      `SELECT title, body, category, channel, line_account_id, metadata
         FROM notifications WHERE event_type = 'friend_tag_side_effect_stuck'
        ORDER BY created_at ASC`,
    )
    .all() as {
      title: string;
      body: string;
      category: string;
      channel: string;
      line_account_id: string | null;
      metadata: string | null;
    }[];
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

/**
 * 時計を次のミリ秒まで進める。
 *
 * jstNow() はミリ秒精度なので、連続する2回の付与が同一ミリ秒に入ると
 * assigned_at が一致する。待てば確率で通る、ではなく**必ず**進む形にする。
 */
function advanceClockOneMillisecond(): void {
  const start = Date.now();
  while (Date.now() === start) {
    // 次のミリ秒まで回す。1ミリ秒未満で抜ける。
  }
}

/**
 * 指定の SQL を**1回だけ**落とす D1 の殻。
 *
 * SQLite には SELECT に仕掛ける手が無いため、D1 の読みが落ちる状況は殻の層で
 * 作る。fireEvent 自体は本物のまま走るので、「Phase 1 の加点と webhook は
 * 外へ出たが、そのあとで落ちた」という本物の並びを再現できる。
 */
function withOneFailingStatement(db: D1Database, pattern: RegExp): D1Database {
  let fired = false;
  const prepare = (sql: string): D1PreparedStatement => {
    if (!fired && pattern.test(sql)) {
      fired = true;
      const fail = async () => {
        throw new Error('d1 read failed');
      };
      return {
        bind: () => ({ first: fail, all: fail, run: fail }),
        first: fail,
        all: fail,
        run: fail,
      } as unknown as D1PreparedStatement;
    }
    return db.prepare(sql);
  };
  return { prepare, batch: (s: D1PreparedStatement[]) => db.batch(s) } as unknown as D1Database;
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

  // ============================================================
  // 審査 REJECT 根拠2: failed の event_tag_change を走り直すと二重に出る
  // ============================================================
  test('加点が外へ出たあとに落ちた tag_change は、failed でも走り直さない', async () => {
    const { db, raw } = setup();

    // fireEvent は Phase 1 (送信 webhook + 加点) を allSettled で済ませたあと
    // getFriendScore を呼ぶ。そこを1回だけ落とすと「加点は外へ出たのに
    // fireEvent は落ちた」状態になる。
    const flaky = withOneFailingStatement(db, /^SELECT score FROM friends WHERE id = \?$/);
    await expect(attachTagAndFireSideEffects(flaky, 'friend-1', 'tag-1')).rejects.toThrow(
      /d1 read failed/,
    );

    expect(counts(raw).tagChangeScores).toBe(1); // 加点はもう外へ出ている
    expect(totalScore(raw)).toBe(5);
    expect(ledgerStatuses(raw).event_tag_change).toBe('failed');

    // 障害は終わっている。同じ経路をもう一度通す。
    expect(await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).toEqual({ added: false });

    // failed は「走らなかった」ではなく「外へ出たかもしれない」。走り直さない。
    expect(counts(raw).tagChangeScores).toBe(1);
    expect(totalScore(raw)).toBe(5);
    expect(ledgerStatuses(raw).event_tag_change).toBe('failed');

    // 止まったことは記録に出ている。
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(1);
    const notices = stuckNotices(raw);
    expect(notices).toHaveLength(1);
    expect(notices[0].channel).toBe('dashboard');
    expect(notices[0].category).toBe('error');
    expect(notices[0].line_account_id).toBe('account-1');
    expect(notices[0].body).toMatch(/タグ変化イベントの発火/);
    expect(JSON.parse(notices[0].metadata!)).toMatchObject({
      friendId: 'friend-1',
      tagId: 'tag-1',
      stepKey: 'event_tag_change',
      status: 'failed',
    });
  });

  test('人が確かめて reopen したときだけ、止まった tag_change が走り直る', async () => {
    const { db, raw } = setup();
    const flaky = withOneFailingStatement(db, /^SELECT score FROM friends WHERE id = \?$/);
    await expect(attachTagAndFireSideEffects(flaky, 'friend-1', 'tag-1')).rejects.toThrow();
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(1);

    // 「外へ出ていない」と人が確かめた、という操作。
    expect(await reopenFriendTagSideEffectRun(db, 'friend-1', 'tag-1', 'event_tag_change')).toBe(
      true,
    );
    // 試した回数と理由は消さない。上限が効いたまま、履歴も残る。
    const reopened = ledger(raw).find((r) => r.step_key === 'event_tag_change')!;
    expect(reopened.status).toBe('pending');
    expect(reopened.attempt_count).toBe(1);
    expect(reopened.last_error).toMatch(/d1 read failed/);

    await retryFriendTagSideEffects(db, 'friend-1', 'tag-1');
    expect(counts(raw).tagChangeScores).toBe(2); // 人の判断で走り直した
    expect(ledgerStatuses(raw).event_tag_change).toBe('completed');
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(0);
  });

  // ============================================================
  // 審査 REJECT 根拠3: 予約が無いと同時2本で二重に走る
  // ============================================================
  test('未了の tag_change へ同時に2本来ても、予約で1回しか走らない', async () => {
    const { db, raw } = setup();
    // 台帳を開いた直後に処理ごと消えた、という状態を作る
    // (付与は確定、工程はすべて pending で一度も走っていない)。
    raw
      .prepare(
        `INSERT INTO friend_tags (friend_id, tag_id, assigned_at)
         VALUES ('friend-1', 'tag-1', '2026-09-11T01:00:00.000+09:00')`,
      )
      .run();
    for (const step of ['mileage', 'scenario_enroll', 'event_tag_change']) {
      raw
        .prepare(
          `INSERT INTO friend_tag_side_effect_runs
             (friend_id, tag_id, step_key, assigned_at, status, attempt_count, created_at, updated_at)
           VALUES ('friend-1', 'tag-1', ?, '2026-09-11T01:00:00.000+09:00', 'pending', 0,
                   '2026-09-11T01:00:00.000+09:00', '2026-09-11T01:00:00.000+09:00')`,
        )
        .run(step);
    }

    await Promise.all([
      attachTagAndFireSideEffects(db, 'friend-1', 'tag-1'),
      attachTagAndFireSideEffects(db, 'friend-1', 'tag-1'),
    ]);

    expect(counts(raw).tagChangeScores).toBe(1);
    expect(totalScore(raw)).toBe(5);
    expect(counts(raw).enrollments).toBe(1);
    expect(counts(raw).mileageEvents).toBe(1);
    expect(ledgerStatuses(raw)).toEqual({
      mileage: 'completed',
      scenario_enroll: 'completed',
      event_tag_change: 'completed',
    });
  });

  test('新規付与が同時に2本来ても、副作用は1回しか走らない', async () => {
    const { db, raw } = setup();
    // tracked-links.ts の Promise.allSettled・webinars.ts の並行呼び出しと同じ形。
    const results = await Promise.allSettled([
      attachTagAndFireSideEffects(db, 'friend-1', 'tag-1'),
      attachTagAndFireSideEffects(db, 'friend-1', 'tag-1'),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(counts(raw)).toEqual({
      friendTags: 1,
      enrollments: 1,
      tagChangeScores: 1,
      mileageEvents: 1,
    });
    expect(totalScore(raw)).toBe(5);
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

    // 止まっている行として数えられる。
    const stuck = await listStuckFriendTagSideEffectRuns(db);
    expect(stuck.map((r) => r.step_key)).toEqual(['event_tag_change']);
  });

  test('落ち続ける工程は上限で止まり、台帳に残って記録にも出る', async () => {
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

    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(1);
    // 上限に達して止まった時点で1件だけ出る。毎回の失敗では出さない。
    const notices = stuckNotices(raw);
    expect(notices).toHaveLength(1);
    expect(JSON.parse(notices[0].metadata!)).toMatchObject({
      stepKey: 'scenario_enroll',
      attemptCount: FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
    });
  });

  test('タグを外して付け直すと、工程は新しい付与としてすべて開き直る', async () => {
    const { db, raw } = setup();
    startEnrollOutage(raw);
    // 1回目はシナリオ登録を落として、台帳に failed と last_error を残す。
    await expect(attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).rejects.toThrow();
    endEnrollOutage(raw);
    const first = ledger(raw);
    const firstAssignedAt = first[0].assigned_at;
    expect(first.find((r) => r.step_key === 'scenario_enroll')!.last_error).toMatch(
      /enroll outage/,
    );

    raw.prepare(`DELETE FROM friend_tags WHERE friend_id = 'friend-1'`).run();
    raw.prepare(`DELETE FROM friend_scenarios WHERE friend_id = 'friend-1'`).run();
    // 同一ミリ秒に収まると付与時刻が一致してしまうので、確実に進める。
    advanceClockOneMillisecond();

    expect(await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1')).toEqual({ added: true });

    const tagRow = raw
      .prepare(`SELECT assigned_at FROM friend_tags WHERE friend_id = 'friend-1'`)
      .get() as { assigned_at: string };
    for (const row of ledger(raw)) {
      expect(row.status).toBe('completed');
      // 守りたい不変条件: 台帳の付与時刻が friend_tags と一致する
      // (マイルの冪等キーがこの時刻を使うため)。時刻の同値に依存しない判定。
      expect(row.assigned_at).toBe(tagRow.assigned_at);
      // 開き直しで 0 に戻って1回走った。差し替えが無ければ 2 になる。
      expect(row.attempt_count).toBe(1);
      expect(row.last_error).toBeNull();
      // 時計を進めたので、前回の付与時刻とは必ず違う。
      expect(row.assigned_at).not.toBe(firstAssignedAt);
    }
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
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(0);
  });

  test('タグを手で外したあとの未了行は、止まっている行に数えない', async () => {
    const { db, raw } = setup();
    const flaky = withOneFailingStatement(db, /^SELECT score FROM friends WHERE id = \?$/);
    await expect(attachTagAndFireSideEffects(flaky, 'friend-1', 'tag-1')).rejects.toThrow();
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(1);

    raw.prepare(`DELETE FROM friend_tags WHERE friend_id = 'friend-1'`).run();
    // もう直せないので、運用の導線には出さない。
    expect(await countStuckFriendTagSideEffectRuns(db)).toBe(0);
    expect(await listStuckFriendTagSideEffectRuns(db)).toEqual([]);
  });
});
