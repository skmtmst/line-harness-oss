/*
 * 交換配送の二重送信防止を、本物の SQLite で確かめる。
 *
 * 手書きモックでは「SQL が正しいか」が分からない。claim の原子性も、
 * outbox を見て送り直さないことも、SQL そのものが仕様なので実 D1 で当てる。
 * 外部送信は数えるだけの fetch 差し替えで、本物の webhook 実行器を通す。
 */
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  claimRedemptionStep,
  createMileageRewardDraft,
  markRedemptionStepSent,
  publishMileageReward,
  reserveMileageRewardRedemption,
} from '@line-crm/db';

import { createTestD1 } from '../test-utils/d1-sqlite.js';
import {
  deliverMileageReward,
  processDueMileageRewardDeliveries,
} from './mileage-reward-delivery.js';

function seedAccount(raw: Database.Database): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '公式A', 'token', 'secret')`,
  ).run();
  raw.prepare(`INSERT INTO users (id, display_name) VALUES ('user-1', '利用者A')`).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, line_account_id)
     VALUES ('friend-1', 'U1', '利用者A', NULL, 'user-1', 'account-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id, entry_type, status,
        amount, reason, source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
     VALUES ('grant-1', 'default', 'user-1', 'friend-1', 'grant', 'available',
             1000, '初期付与', 'test', 'event-1', 'grant-1', '{}',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  ).run();
  raw.prepare(
    `INSERT INTO outgoing_webhooks (id, name, url, line_account_id, is_active)
     VALUES ('webhook-1', '外部受け口', 'https://example.com/hook', 'account-1', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO common_actions (id, line_account_id, name, status)
     VALUES ('action-1', 'account-1', '交換後の送信', 'published')`,
  ).run();
  raw.prepare(
    `INSERT INTO common_action_versions
       (id, common_action_id, version_number, status, action_config, published_at)
     VALUES ('action-version-1', 'action-1', 1, 'published',
             '[{"id":"w1","type":"send_webhook","params":{"webhookId":"webhook-1"},"onFailure":"stop"}]',
             '2026-08-01T00:00:00.000Z')`,
  ).run();
}

async function seedWebhookReward(db: D1Database): Promise<string> {
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'account-1',
    draft: {
      name: '外部特典', rewardKind: 'template', requiredMiles: 300,
      commonActionVersionId: 'action-version-1',
    },
  });
  return (await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' })).id;
}

/** 指定した SQL の初回 run だけ落とす。本物の確定失敗を再現する。 */
function withFirstRunFault(
  db: D1Database,
  shouldFault: (sql: string) => boolean,
): { faulty: D1Database; disarm: () => void } {
  let armed = true;
  const inner = db as unknown as {
    prepare: (sql: string) => {
      bind: (...args: unknown[]) => Record<string, unknown>;
      [key: string]: unknown;
    };
    batch: (statements: unknown[]) => Promise<unknown[]>;
  };
  const faulty = {
    prepare: (sql: string) => {
      const prepared = inner.prepare(sql);
      return {
        ...prepared,
        bind: (...args: unknown[]) => {
          const bound = prepared.bind(...args) as Record<string, (...a: never[]) => Promise<unknown>>;
          const originalRun = bound.run as () => Promise<unknown>;
          return {
            ...bound,
            run: async () => {
              if (armed && shouldFault(sql)) {
                armed = false;
                throw new Error('injected confirm failure');
              }
              return originalRun();
            },
          };
        },
      };
    },
    batch: (statements: unknown[]) => inner.batch(statements),
  } as unknown as D1Database;
  return { faulty, disarm: () => { armed = false; } };
}

function countFetches() {
  let count = 0;
  const seenKeys: Array<string | null> = [];
  const fetch = async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    count += 1;
    seenKeys.push(init?.headers?.['Idempotency-Key'] ?? null);
    return new Response('{}', { status: 200 });
  };
  return { fetch: fetch as typeof globalThis.fetch, count: () => count, keys: () => seenKeys };
}

describe('交換配送の二重送信防止(実D1)', () => {
  it('外部成功直後の確定失敗→回収でも外部送信は1回', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-confirm-fault', requestFingerprint: 'fp-confirm-fault',
    });

    const counter = countFetches();
    // 成功記録(試行テーブルへの書き込み)だけ落とす。手順の sent 記録は残る。
    const { faulty } = withFirstRunFault(
      db, (sql) => sql.includes('mileage_redemption_attempts'),
    );
    const first = await deliverMileageReward(faulty, reserved.redemption.id, {
      fetch: counter.fetch,
    });
    expect(counter.count()).toBe(1);
    // 失敗には落とさない。落とすとやり直しで再送する。
    expect(first).toMatchObject({ status: 'delivery_failed' });
    expect(first.message ?? '').toContain('確認');
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });

    // 貸出期限を過ぎた取り残しを cron が回収する。送り直さない。
    raw.prepare(
      `UPDATE mileage_redemptions SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`,
    ).run(reserved.redemption.id);
    const swept = await processDueMileageRewardDeliveries(db, {
      now: new Date().toISOString(), fetch: counter.fetch,
    });
    expect(swept).toMatchObject({ processed: 1, succeeded: 1 });
    expect(counter.count()).toBe(1);
    // 受け手側にも安定した冪等キーが渡っている。
    expect(typeof counter.keys()[0]).toBe('string');
    expect(raw.prepare(
      `SELECT status, attempt_count FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded', attempt_count: 1 });
    // 残高は予約時の1回だけ減る。
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`,
    ).get()).toEqual({ count: 1 });
  });

  it('並行するやり直しと初回配送は片方だけが送る', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-race', requestFingerprint: 'fp-race',
    });

    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    let fetches = 0;
    const gatedFetch = (async () => {
      fetches += 1;
      await gate;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const first = deliverMileageReward(db, reserved.redemption.id, { fetch: gatedFetch });
    const second = deliverMileageReward(db, reserved.redemption.id, { fetch: gatedFetch });
    // 先勝ちが送信中になるまで待つ。負けは claim を取れずに降りる。
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFetch();
    const [winner, loser] = await Promise.all([first, second]);

    expect(fetches).toBe(1);
    const statuses = [winner.status, loser.status].sort();
    expect(statuses).toEqual(['delivery_failed', 'succeeded']);
    const waiting = [winner, loser].find((result) => result.status === 'delivery_failed');
    expect(waiting?.message ?? '').toContain('確認しています');
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded' });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemption_step_deliveries WHERE status = 'sent'`,
    ).get()).toEqual({ count: 1 });
  });

  it('sent確定の書き込み失敗→送達不明→回収は送り直さず確定だけ進める', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-unknown', requestFingerprint: 'fp-unknown',
    });

    const counter = countFetches();
    const stepUpdate = (sql: string) =>
      sql.includes('mileage_redemption_step_deliveries')
      && sql.trimStart().toUpperCase().startsWith('UPDATE');
    // 初回の確定書き込みだけ落とす。外部送信は成功している。
    const { faulty } = withFirstRunFault(db, stepUpdate);
    const first = await deliverMileageReward(faulty, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(counter.count()).toBe(1);
    expect(first).toMatchObject({ status: 'delivery_failed' });
    expect(first.message ?? '').toContain('確認');
    // 失敗には落とさない。落とすとやり直しで再送する。
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });
    // 送ったかもしれない証言が残る。
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'started', needsReconcile: 1 });

    // 貸出期限を過ぎた取り残しを cron が回収する。送り直さない。
    raw.prepare(
      `UPDATE mileage_redemptions SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`,
    ).run(reserved.redemption.id);
    const swept = await processDueMileageRewardDeliveries(db, {
      now: '2026-09-09T01:00:00.000Z', fetch: counter.fetch,
    });
    expect(swept).toMatchObject({ processed: 1, succeeded: 1 });
    expect(counter.count()).toBe(1);
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'sent', needsReconcile: 0 });
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded' });
  });

  it('貸出期限を過ぎたら別走者が引き継ぎ、遅い旧持ち主の確定は拒否する', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-takeover', requestFingerprint: 'fp-takeover',
    });

    // 走者Aが貸出を取る。送る前に止まったとする(送信はしない)。
    const stepKey = '0:w1';
    const stepRow = () => raw.prepare(
      `SELECT owner, generation, fence_token AS fenceToken, status
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ? AND step_key = ?`,
    ).get(reserved.redemption.id, stepKey) as {
      owner: string; generation: number; fenceToken: string; status: string;
    };
    const claimA = await claimRedemptionStep(db, {
      redemptionId: reserved.redemption.id, stepKey,
      idempotencyKey: 'takeover-key', owner: 'runner-a', fenceToken: 'fence-a1',
      leaseExpiresAt: '2026-09-09T00:05:00.000Z', now: '2026-09-09T00:00:00.000Z',
    });
    expect(claimA).toBe('send');

    // 貸出期限が過ぎる。走者Bの配送が引き継いで送る(外部送信は1回)。
    raw.prepare(
      `UPDATE mileage_redemption_step_deliveries
          SET lease_expires_at = '2020-01-01T00:00:00.000Z' WHERE redemption_id = ?`,
    ).run(reserved.redemption.id);
    const counter = countFetches();
    const second = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T01:00:00.000Z',
    });
    expect(second.status).toBe('succeeded');
    expect(counter.count()).toBe(1);
    // 世代が進み、持ち主が替わっている。
    expect(stepRow()).toMatchObject({ owner: expect.not.stringMatching(/^runner-a$/), generation: 2, status: 'sent' });

    // 遅れてきた旧持ち主の確定は通らない。Bの確定を壊さない。
    await expect(markRedemptionStepSent(db, {
      redemptionId: reserved.redemption.id, stepKey,
      owner: 'runner-a', fenceToken: 'fence-a1', now: '2026-09-09T01:01:00.000Z',
    })).rejects.toThrow('特典の送信後の確定に失敗しました');
    expect(stepRow().status).toBe('sent');
  });

  it('貸出中の手順は送らずに待ち、期限後に引き継いで1回だけ送る', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-busy', requestFingerprint: 'fp-busy',
    });

    // 走者Aが貸出を持っている(送信はまだ)。走者Bの配送は送らずに待つ。
    expect(await claimRedemptionStep(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      idempotencyKey: 'busy-key', owner: 'runner-a', fenceToken: 'fence-a1',
      leaseExpiresAt: '2026-09-09T00:05:00.000Z', now: '2026-09-09T00:00:00.000Z',
    })).toBe('send');
    const counter = countFetches();
    const waiting = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:01:00.000Z',
    });
    expect(waiting).toMatchObject({ status: 'delivery_failed' });
    expect(waiting.message ?? '').toContain('確認しています');
    expect(counter.count()).toBe(0);
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });

    // 期限が過ぎたら引き継いで送る。外部送信はこの1回だけ。
    const recovered = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T01:00:00.000Z',
    });
    expect(recovered.status).toBe('succeeded');
    expect(counter.count()).toBe(1);
  });
});
