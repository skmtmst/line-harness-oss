/*
 * 友だち単位の配信予定（IDEA-05 / B段階導入）。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）で試算口を確かめる：
 *   - 未開始の友だち …… 現在の公開版で予定が立ち、副作用は無い
 *   - 購読中の友だち …… 固定された公開版を読み、次の予定は購読行の
 *     next_delivery_at をそのまま使う（予定の正本は購読行）
 *   - 停止中・送れない友だち …… 予定は未確定、理由を返す
 *   - 条件分岐 …… 実行側と同じ evaluateCondition で枝分かれを再現する
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { simulateFriendPlan } from './scenario-v6-contract.js';

let store: SqliteD1;

/*
 * 公開版の通（step_order は画面と同じ1始まり）。
 *   1通目 …… そのまま届く
 *   2通目 …… タグ「会員」を持たない人は 4通目へ分岐（3通目は飛ばされる）
 *   3通目 …… 条件を満たした人だけ届く
 *   4通目 …… 分岐先・順送りどちらでも届く
 */
const STEPS_SNAPSHOT = JSON.stringify([
  {
    version_step_id: 'vs-1', step_order: 1, delay_minutes: 0,
    message_type: 'text', message_content: '1通目',
  },
  {
    version_step_id: 'vs-2', step_order: 2, delay_minutes: 60,
    message_type: 'text', message_content: '条件つき2通目',
    condition_type: 'tag_exists', condition_value: 'tag-1', next_step_on_false: 4,
  },
  {
    version_step_id: 'vs-3', step_order: 3, delay_minutes: 60,
    message_type: 'text', message_content: '条件を通った人だけの3通目',
  },
  {
    version_step_id: 'vs-4', step_order: 4, delay_minutes: 120,
    message_type: 'text', message_content: '4通目',
  },
]);

function seed(): void {
  const raw = store.raw;
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES ('acc-1', 'channel-1', 'アカウント1', 'token', 'secret', 1)`,
  ).run();
  raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '会員', 'acc-1')`).run();

  for (const [id, active] of [['sc-1', 1], ['sc-stopped', 0]] as const) {
    raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, line_account_id, is_active, allow_concurrent, delivery_mode)
       VALUES (?, ?, 'manual', 'acc-1', ?, 1, 'relative')`,
    ).run(id, `筋書き${id}`, active);
    raw.prepare(
      `INSERT INTO scenario_versions
         (id, scenario_id, version_number, delivery_mode, steps_snapshot, status, published_at, created_at, updated_at)
       VALUES (?, ?, 1, 'relative', ?, 'published', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
    ).run(`v-${id}`, id, STEPS_SNAPSHOT);
    raw.prepare(
      `UPDATE scenarios SET current_published_version_id = ? WHERE id = ?`,
    ).run(`v-${id}`, id);
  }

  for (const [id, following] of [
    ['f-new', 1],
    ['f-tag', 1],
    ['f-active', 1],
    ['f-paused', 1],
    ['f-completed', 1],
    ['f-blocked', 0],
  ] as const) {
    insertFriend(raw, id, { line_account_id: 'acc-1', is_following: following });
  }
  raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES ('f-tag', 'tag-1')`).run();

  const subs: Array<[string, string, string, number, string | null, string | null]> = [
    // id, friend, status, current_step_order, next_delivery_at, pause_reason
    ['sub-active', 'f-active', 'active', 1, '2026-09-10T09:00:00.000+09:00', null],
    ['sub-paused', 'f-paused', 'paused', 1, null, 'manual'],
    ['sub-completed', 'f-completed', 'completed', 4, null, null],
  ];
  for (const [subId, friendId, status, stepOrder, nextAt, pauseReason] of subs) {
    raw.prepare(
      `INSERT INTO friend_scenarios
         (id, friend_id, scenario_id, current_step_order, status, pause_reason,
          started_at, next_delivery_at, published_version_id, updated_at)
       VALUES (?, ?, 'sc-1', ?, ?, ?, '2026-09-01T00:00:00.000+09:00', ?, 'v-sc-1', '2026-09-01T00:00:00.000+09:00')`,
    ).run(subId, friendId, stepOrder, status, pauseReason, nextAt);
  }
}

beforeEach(() => {
  store = createTestD1();
  seed();
});

describe('友だち単位の配信予定（IDEA-05）', () => {
  it('未開始の友だちは現在の公開版で予定が立ち、副作用は無い', async () => {
    const before = store.raw.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get() as { n: number };
    const plan = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'f-tag',
    });

    expect(plan.sideEffects).toBe(false);
    expect(plan.basis).toBe('published');
    expect(plan.subscription).toBeNull();
    expect(plan.start.state).toBe('ok');
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0]).toMatchObject({ stepOrder: 1, outcome: 'deliver' });
    expect(plan.steps[0].scheduledAt).not.toBeNull();
    // タグを持つ友だちは2通目の条件を通り、3通目も届く見通し。
    expect(plan.steps[1]).toMatchObject({ stepOrder: 2, outcome: 'deliver' });
    expect(plan.steps[2]).toMatchObject({ stepOrder: 3, outcome: 'deliver' });
    expect(plan.steps[3]).toMatchObject({ stepOrder: 4, outcome: 'deliver' });

    const after = store.raw.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get() as { n: number };
    expect(after.n).toBe(before.n);
    const logs = store.raw.prepare(`SELECT COUNT(*) AS n FROM messages_log`).get() as { n: number };
    expect(logs.n).toBe(0);
  });

  it('条件を満たさない友だちは分岐先へ進み、飛ばされる通は「送らず次へ」', async () => {
    const plan = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'f-new',
    });

    const byOrder = new Map(plan.steps.map((step) => [step.stepOrder, step]));
    // 実行側は条件不一致で next_step_on_false の通へ進める。
    expect(byOrder.get(2)).toMatchObject({ outcome: 'branch', dynamic: true });
    expect(byOrder.get(2)?.reason).toContain('4通目');
    expect(byOrder.get(2)?.reason).toContain('会員');
    expect(byOrder.get(3)).toMatchObject({ outcome: 'skip', dynamic: true });
    expect(byOrder.get(4)).toMatchObject({ outcome: 'deliver' });
    // 動的条件を含むので、未確定であることが警告に出る。
    expect(plan.warnings.join('')).toContain('配信時点');
  });

  it('購読中は固定版を読み、いちばん次の予定は購読行の next_delivery_at を使う', async () => {
    const plan = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'f-active',
    });

    expect(plan.basis).toBe('pinned');
    expect(plan.subscription).toMatchObject({
      status: 'active',
      currentStepOrder: 1,
      nextDeliveryAt: '2026-09-10T09:00:00.000+09:00',
    });
    // 配信済みの1通目は予定に出さない。
    expect(plan.steps.map((step) => step.stepOrder)).toEqual([2, 3, 4]);
    expect(plan.steps[0].scheduledAt).toBe('2026-09-10T09:00:00.000+09:00');
    // f-active はタグを持たない → 2通目は4通目へ分岐。
    expect(plan.steps[0].outcome).toBe('branch');
    expect(plan.steps[1]).toMatchObject({ stepOrder: 3, outcome: 'skip' });
    expect(plan.steps[2]).toMatchObject({ stepOrder: 4, outcome: 'deliver' });
  });

  it('停止中の購読は以降の予定がすべて未確定', async () => {
    const plan = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'f-paused',
    });

    expect(plan.subscription?.status).toBe('paused');
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(step.outcome).toBe('undetermined');
      expect(step.scheduledAt).toBeNull();
      expect(step.reason).toContain('停止');
    }
  });

  it('フォローしていない友だち・停止中のシナリオは開始が blocked', async () => {
    const blocked = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'f-blocked',
    });
    expect(blocked.start.state).toBe('blocked');
    expect(blocked.start.reasons.join('')).toContain('解除');
    for (const step of blocked.steps) {
      expect(step.outcome).toBe('undetermined');
    }

    const stopped = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-stopped', lineAccountId: 'acc-1', friendId: 'f-new',
    });
    expect(stopped.start.state).toBe('blocked');
    expect(stopped.start.reasons.join('')).toContain('停止中');
  });

  it('完了した友だちは再開始の扱いで1通目からの予定が立つ', async () => {
    const plan = await simulateFriendPlan(store.db, {
      scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'f-completed',
    });

    expect(plan.subscription?.status).toBe('completed');
    expect(plan.start.state).toBe('ok');
    expect(plan.start.reasons.join('')).toContain('もう一度開始');
    expect(plan.steps.map((step) => step.stepOrder)).toEqual([1, 2, 3, 4]);
  });

  it('存在しない友だち・シナリオはエラーになる', async () => {
    await expect(
      simulateFriendPlan(store.db, {
        scenarioId: 'sc-1', lineAccountId: 'acc-1', friendId: 'nobody',
      }),
    ).rejects.toThrow('友だちが見つかりません');
    await expect(
      simulateFriendPlan(store.db, {
        scenarioId: 'missing', lineAccountId: 'acc-1', friendId: 'f-new',
      }),
    ).rejects.toThrow('シナリオが見つかりません');
  });
});
