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
  createMileageRewardDraft,
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
});
