/*
 * 交換配送の二重送信防止を、本物の SQLite で確かめる。
 *
 * 手書きモックでは「SQL が正しいか」が分からない。claim の原子性も、
 * outbox を見て送り直さないことも、SQL そのものが仕様なので実 D1 で当てる。
 * 外部送信は数えるだけの fetch 差し替えで、本物の webhook 実行器を通す。
 */
import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { asD1 } from '@line-crm/db/test/d1-test-helper.js';

import {
  claimRedemptionStep,
  clearRedemptionStepIntent,
  createMileageRewardDraft,
  findIncompleteMileageRefunds,
  getMileageRedemption,
  importMileageRewardCodes,
  isMileageRefundComplete,
  listMileageRedemptions,
  markRedemptionStepSent,
  publishMileageReward,
  recoverIncompleteMileageRefunds,
  refundMileageRewardRedemption,
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

/**
 * 2手順(外部受け口が2つ)の特典。1手順目が送れて2手順目で落ちた交換を作れる。
 * この形が二重付与のいちばん危ないところ: やり直しで1手順目を送り直すと
 * 特典が2回届く。手順ごとの outbox がそれを止めていることをここで当てる。
 */
function seedTwoStepAction(raw: Database.Database): void {
  raw.prepare(
    `INSERT INTO outgoing_webhooks (id, name, url, line_account_id, is_active)
     VALUES ('webhook-2', '外部受け口2', 'https://example.org/hook2', 'account-1', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO common_actions (id, line_account_id, name, status)
     VALUES ('action-2', 'account-1', '交換後の2段送信', 'published')`,
  ).run();
  raw.prepare(
    `INSERT INTO common_action_versions
       (id, common_action_id, version_number, status, action_config, published_at)
     VALUES ('action-version-2', 'action-2', 1, 'published',
             '[{"id":"w1","type":"send_webhook","params":{"webhookId":"webhook-1"},"onFailure":"stop"},'
             || '{"id":"w2","type":"send_webhook","params":{"webhookId":"webhook-2"},"onFailure":"stop"}]',
             '2026-08-01T00:00:00.000Z')`,
  ).run();
}

async function seedTwoStepReward(db: D1Database): Promise<string> {
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'account-1',
    draft: {
      name: '2段特典', rewardKind: 'template', requiredMiles: 300,
      commonActionVersionId: 'action-version-2',
    },
  });
  return (await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' })).id;
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

async function seedRefundWebhookReward(db: D1Database): Promise<string> {
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'account-1',
    draft: {
      name: '返却あり特典', rewardKind: 'template', requiredMiles: 300,
      commonActionVersionId: 'action-version-1', failurePolicy: 'refund',
    },
  });
  return (await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' })).id;
}

async function seedRefundTwoStepReward(db: D1Database): Promise<string> {
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'account-1',
    draft: {
      name: '返却あり2段特典', rewardKind: 'template', requiredMiles: 300,
      commonActionVersionId: 'action-version-2', failurePolicy: 'refund',
    },
  });
  return (await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' })).id;
}

/**
 * 指定した SQL の run を最初の `times` 回だけ落とす。
 * 送ったあとの確定書き込みが何度も失敗する連続障害を再現する。
 */
function withFirstRunFault(
  db: D1Database,
  shouldFault: (sql: string) => boolean,
  times = 1,
): { faulty: D1Database; disarm: () => void } {
  let armed = times;
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
              if (armed > 0 && shouldFault(sql)) {
                armed -= 1;
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
  return { faulty, disarm: () => { armed = 0; } };
}

/*
 * 送信直前の安全検査は、宛先の名前をその場で引き直す(本流 #1482)。
 * 引き直しは `fetch` で DoH を叩くので、差し替えた fetch をそのまま
 * 数えると「外部へ送った回数」が名前引きの分だけ水増しされる。
 * ここでは DoH だけ固定の公開IPで答え、数えるのは受け口への送信だけにする。
 */
const DOH_PREFIX = 'https://cloudflare-dns.com/dns-query';

function isDohRequest(url: unknown): boolean {
  return String(url).startsWith(DOH_PREFIX);
}

/** 検査時と接続直前の2回とも同じ答えを返す。違うと `dns_changed` で送らない。 */
function dohResponse(url: unknown): Response {
  const type = new URL(String(url)).searchParams.get('type');
  const answer = type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [];
  return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
}

/**
 * 受け口ごとに送信を数える。DoH は数えない。
 * 「どの手順が何回外部へ届いたか」を手順ごとに見るために URL で分ける。
 */
function countFetchesByHost(responder: (host: string, calls: number) => Response) {
  const perHost = new Map<string, number>();
  const fetch = async (url: unknown) => {
    if (isDohRequest(url)) return dohResponse(url);
    const host = new URL(String(url)).host;
    const calls = (perHost.get(host) ?? 0) + 1;
    perHost.set(host, calls);
    return responder(host, calls);
  };
  return {
    fetch: fetch as typeof globalThis.fetch,
    count: (host: string) => perHost.get(host) ?? 0,
    total: () => [...perHost.values()].reduce((sum, value) => sum + value, 0),
  };
}

function countFetches() {
  let count = 0;
  const seenKeys: Array<string | null> = [];
  const fetch = async (url: unknown, init?: { headers?: Record<string, string> }) => {
    if (isDohRequest(url)) return dohResponse(url);
    count += 1;
    // N-372: 外部連携Webhookの冪等キーは X-Harness-Event-Id に統一した。
    seenKeys.push(init?.headers?.['X-Harness-Event-Id'] ?? null);
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
    const gatedFetch = (async (url: unknown) => {
      if (isDohRequest(url)) return dohResponse(url);
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

  it('確定書き込みの連続失敗でも送り直さず照合待ちに残す', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-confirm-storm', requestFingerprint: 'fp-confirm-storm',
    });

    const counter = countFetches();
    const stepUpdate = (sql: string) =>
      sql.includes('mileage_redemption_step_deliveries')
      && sql.trimStart().toUpperCase().startsWith('UPDATE');
    // 確定の3回の試しをすべて落とす。外部送信は成功している。
    const { faulty } = withFirstRunFault(db, stepUpdate, 3);
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
    // 証言は送る前に残っているので、確定が何度失敗しても残る。
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
    expect(swept).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(counter.count()).toBe(1);
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'started', needsReconcile: 1 });
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });
  });

  it('外部成功後の記録失敗が続いても送り直さない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-unconfirmed', requestFingerprint: 'fp-unconfirmed',
    });

    const counter = countFetches();
    // 送信後の記録は何度やっても落ちる。外部送信自体は成功する。
    const outcomeUpdate = (sql: string) =>
      sql.includes('outgoing_webhooks')
      && sql.trimStart().toUpperCase().startsWith('UPDATE');
    const { faulty } = withFirstRunFault(db, outcomeUpdate, 10);
    const first = await deliverMileageReward(faulty, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(counter.count()).toBe(1);
    expect(first).toMatchObject({ status: 'delivery_failed' });
    expect(first.message ?? '').toContain('確認');
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'started', needsReconcile: 1 });

    // 回収も送り直さず、照合待ちのまま残す。
    raw.prepare(
      `UPDATE mileage_redemptions SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`,
    ).run(reserved.redemption.id);
    const swept = await processDueMileageRewardDeliveries(db, {
      now: '2026-09-09T01:00:00.000Z', fetch: counter.fetch,
    });
    expect(swept).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(counter.count()).toBe(1);
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });
  });

  it('一瞬の確定失敗はやり直して確定する', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-transient', requestFingerprint: 'fp-transient',
    });

    const counter = countFetches();
    const stepUpdate = (sql: string) =>
      sql.includes('mileage_redemption_step_deliveries')
      && sql.trimStart().toUpperCase().startsWith('UPDATE');
    // 初回の確定だけ落とす。二度目の試しで通る。
    const { faulty } = withFirstRunFault(db, stepUpdate, 1);
    const result = await deliverMileageReward(faulty, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(result.status).toBe('succeeded');
    expect(counter.count()).toBe(1);
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'sent', needsReconcile: 0 });
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded' });
  });

  it('証言消し後の期限切れは新持ち主だけが送り、旧持ち主は送り直せない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserve = (idempotencyKey: string, requestFingerprint: string) =>
      reserveMileageRewardRedemption(db, {
        lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
        idempotencyKey, requestFingerprint,
      });
    const stepKey = '0:w1';
    const leaseA = (redemptionId: string, fenceToken: string, now: string) => ({
      redemptionId, stepKey, idempotencyKey: 'takeover-key',
      owner: 'runner-a', fenceToken,
      leaseExpiresAt: '2026-09-09T00:05:00.000Z', now,
    });

    // 先に貸出の fencing だけ確かめる。Aが取り、Bが引き継ぐ。
    const first = await reserve('e2e-takeover-fence', 'fp-takeover-fence');
    expect(await claimRedemptionStep(db, leaseA(first.redemption.id, 'fence-a1', '2026-09-09T00:00:00.000Z'))).toBe('send');
    await clearRedemptionStepIntent(db, {
      redemptionId: first.redemption.id, stepKey,
      owner: 'runner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:01:00.000Z',
    });
    raw.prepare(
      `UPDATE mileage_redemption_step_deliveries
          SET lease_expires_at = '2020-01-01T00:00:00.000Z' WHERE redemption_id = ?`,
    ).run(first.redemption.id);
    expect(await claimRedemptionStep(db, {
      redemptionId: first.redemption.id, stepKey, idempotencyKey: 'takeover-key',
      owner: 'runner-b', fenceToken: 'fence-b1',
      leaseExpiresAt: '2026-09-09T01:05:00.000Z', now: '2026-09-09T01:00:00.000Z',
    })).toBe('send');
    // 期限切れの旧持ち主が取り直しても、貸出は戻らず照合待ちのまま。
    expect(await claimRedemptionStep(db, {
      redemptionId: first.redemption.id, stepKey, idempotencyKey: 'takeover-key',
      owner: 'runner-a', fenceToken: 'fence-a2',
      leaseExpiresAt: '2026-09-09T01:06:00.000Z', now: '2026-09-09T01:01:00.000Z',
    })).toBe('reconcile');
    // 遅れてきた旧持ち主の確定は通らない。
    await expect(markRedemptionStepSent(db, {
      redemptionId: first.redemption.id, stepKey,
      owner: 'runner-a', fenceToken: 'fence-a1', now: '2026-09-09T01:02:00.000Z',
    })).rejects.toThrow('特典の送信後の確定に失敗しました');

    // 配送として通すと、新持ち主の1回だけ送って成功する。
    const second = await reserve('e2e-takeover', 'fp-takeover');
    expect(await claimRedemptionStep(db, leaseA(second.redemption.id, 'fence-a1', '2026-09-09T00:00:00.000Z'))).toBe('send');
    await clearRedemptionStepIntent(db, {
      redemptionId: second.redemption.id, stepKey,
      owner: 'runner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:01:00.000Z',
    });
    raw.prepare(
      `UPDATE mileage_redemption_step_deliveries
          SET lease_expires_at = '2020-01-01T00:00:00.000Z' WHERE redemption_id = ?`,
    ).run(second.redemption.id);
    const counter = countFetches();
    const delivered = await deliverMileageReward(db, second.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T01:00:00.000Z',
    });
    expect(delivered.status).toBe('succeeded');
    expect(counter.count()).toBe(1);
    // 世代が進み、持ち主が替わっている。
    expect(raw.prepare(
      `SELECT owner, generation, status
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ? AND step_key = ?`,
    ).get(second.redemption.id, stepKey)).toMatchObject({
      owner: expect.not.stringMatching(/^runner-a$/), generation: 2, status: 'sent',
    });
  });

  it('貸出中も期限切れの証言つきも送らずに待つ', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-busy', requestFingerprint: 'fp-busy',
    });

    // 走者Aが証言つきの貸出を持っている。走者Bの配送は送らずに待つ。
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

    // 期限が過ぎても証言があるので送り直さない。照合待ちのまま残す。
    const recovered = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T01:00:00.000Z',
    });
    expect(recovered).toMatchObject({ status: 'delivery_failed' });
    expect(recovered.message ?? '').toContain('確認しています');
    expect(counter.count()).toBe(0);
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'started', needsReconcile: 1 });
  });

  it('送る前の失敗は証言を消してやり直せる', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-flaky', requestFingerprint: 'fp-flaky',
    });

    // 初回は受信先が500で断る。二度目は受け付ける。
    let calls = 0;
    const flakyFetch = (async (url: unknown) => {
      if (isDohRequest(url)) return dohResponse(url);
      calls += 1;
      if (calls === 1) return new Response('ng', { status: 500 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const first = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: flakyFetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(first).toMatchObject({ status: 'delivery_failed' });
    expect(first.retryAt).not.toBeNull();
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'started', needsReconcile: 0 });

    // 送っていないことが決まっているので、やり直しは送ってよい。
    const second = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: flakyFetch, now: () => '2026-09-09T01:00:00.000Z',
    });
    expect(second.status).toBe('succeeded');
    expect(calls).toBe(2);
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded' });
  });
  /*
   * 司令塔の再審査条件: 「同じ失敗した交換を2回再実行しても特典が二重に
   * 付与されない」。いちばん危ないのは、複数手順のうち前半が届いたあとで
   * 後半が落ちた交換。やり直しで前半を送り直すと特典が2回届く。
   */
  it('前半が届いた交換をやり直しても前半は送り直さない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    seedTwoStepAction(raw);
    const rewardId = await seedTwoStepReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-two-step', requestFingerprint: 'fp-two-step',
    });

    // 1手順目(example.com)は通る。2手順目(example.org)は最初だけ断る。
    const counter = countFetchesByHost((host, calls) => (
      host === 'example.org' && calls === 1
        ? new Response('ng', { status: 500 })
        : new Response('{}', { status: 200 })
    ));

    const failed = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(failed).toMatchObject({ status: 'delivery_failed' });
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(1);
    // 1手順目は送信済みとして残る。2手順目は送っていないことが決まっている。
    expect(raw.prepare(
      `SELECT step_key AS stepKey, status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?
        ORDER BY step_key`,
    ).all(reserved.redemption.id)).toEqual([
      { stepKey: '0:w1', status: 'sent', needsReconcile: 0 },
      { stepKey: '1:w2', status: 'started', needsReconcile: 0 },
    ]);

    // やり直し1回目。2手順目だけ送り直す。
    const retried = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:10:00.000Z',
    });
    expect(retried.status).toBe('succeeded');
    // ここが二重付与の防波堤。1手順目は増えない。
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(2);

    // やり直し2回目。成功済みなのでどの手順も送らない。
    const again = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:20:00.000Z',
    });
    expect(again.status).toBe('succeeded');
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(2);

    // 残高は予約の1回だけ減り、使った記録も1件しかない。
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`,
    ).get()).toEqual({ count: 1 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND status = 'sent'`,
    ).get(reserved.redemption.id)).toEqual({ count: 2 });
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded' });
  });

  /*
   * 司令塔の再審査条件: 「同時2実行も Promise.all で当てる」。
   * 間に待ちを挟まず、失敗中の同じ交換へやり直しを2本同時に当てる。
   */
  it('失敗中の交換への同時2やり直しでも外部送信は1回だけ', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-parallel-retry', requestFingerprint: 'fp-parallel-retry',
    });

    // まず失敗中にする。受信先が断ったので、送っていないことが決まっている。
    let refuse = true;
    const counter = countFetchesByHost(() => (
      refuse ? new Response('ng', { status: 500 }) : new Response('{}', { status: 200 })
    ));
    const first = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(first).toMatchObject({ status: 'delivery_failed' });
    expect(counter.total()).toBe(1);
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivery_failed' });

    // 同時に2本やり直す。待ちを挟まない。
    refuse = false;
    const results = await Promise.all([
      deliverMileageReward(db, reserved.redemption.id, {
        fetch: counter.fetch, now: () => '2026-09-09T00:10:00.000Z',
      }),
      deliverMileageReward(db, reserved.redemption.id, {
        fetch: counter.fetch, now: () => '2026-09-09T00:10:00.000Z',
      }),
    ]);

    // 外部へ届いたのは失敗の1回とやり直しの1回だけ。3回目は無い。
    expect(counter.total()).toBe(2);
    expect(results.some((result) => result.status === 'succeeded')).toBe(true);
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded' });
    // 手順の送信済みは1行。残高も使った記録も1回のまま。
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND status = 'sent'`,
    ).get(reserved.redemption.id)).toEqual({ count: 1 });
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`,
    ).get()).toEqual({ count: 1 });
  });

  /*
   * 司令塔の再審査条件: 「再実行の途中で落ちても中途半端な状態が残らない」。
   * 前半が届いたあと、確定書き込みが落ち続ける場合を当てる。
   */
  it('やり直しの途中で確定が落ちても中途半端な付与が残らない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    seedTwoStepAction(raw);
    const rewardId = await seedTwoStepReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-two-step-storm', requestFingerprint: 'fp-two-step-storm',
    });

    const counter = countFetchesByHost(() => new Response('{}', { status: 200 }));
    const stepUpdate = (sql: string) =>
      sql.includes('mileage_redemption_step_deliveries')
      && sql.trimStart().toUpperCase().startsWith('UPDATE');
    // 1手順目の確定を3回とも落とす。外部送信は終わっている。
    const { faulty } = withFirstRunFault(db, stepUpdate, 3);
    const stalled = await deliverMileageReward(faulty, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:00:00.000Z',
    });
    expect(stalled).toMatchObject({ status: 'delivery_failed' });
    expect(stalled.message ?? '').toContain('確認');
    // 1手順目だけ送っており、2手順目には手を付けていない。
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(0);
    // 交換は失敗に落ちず、照合待ちで止まる。行は1手順目の1行だけ。
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });
    expect(raw.prepare(
      `SELECT step_key AS stepKey, status, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ?
        ORDER BY step_key`,
    ).all(reserved.redemption.id)).toEqual([
      { stepKey: '0:w1', status: 'started', needsReconcile: 1 },
    ]);

    // やり直しても送り直さない。2手順目にも進まない(中途半端に届けない)。
    const retried = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch, now: () => '2026-09-09T00:10:00.000Z',
    });
    expect(retried).toMatchObject({ status: 'delivery_failed' });
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(0);
    // 貸出期限を過ぎた回収でも送り直さない。
    raw.prepare(
      `UPDATE mileage_redemptions SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`,
    ).run(reserved.redemption.id);
    expect(await processDueMileageRewardDeliveries(db, {
      now: '2026-09-09T02:00:00.000Z', fetch: counter.fetch,
    })).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(0);
    // 残高も使った記録も予約の1回のまま。成功にも返金にもしない。
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`,
    ).get()).toEqual({ count: 1 });
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivering' });
  });
  /*
   * 上の2手順の試験は `now` を +10分へ進めてやり直しており、手順の貸出が
   * 切れたあとの道しか通っていなかった。**ルートは `now` を渡さず実時計を
   * 使う**ので、管理画面から押す道はそこでは踏まれない(#641 司令塔独立審査)。
   * ここは `now` を一切渡さず、失敗した直後にそのまま押す。
   */
  it('実時計のまま失敗直後にやり直しても、前半は送り直さず後半だけ送る', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    seedTwoStepAction(raw);
    const rewardId = await seedTwoStepReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-two-step-realtime', requestFingerprint: 'fp-two-step-realtime',
    });

    const counter = countFetchesByHost((host, calls) => (
      host === 'example.org' && calls === 1
        ? new Response('ng', { status: 500 })
        : new Response('{}', { status: 200 })
    ));

    // 初回。`now` を渡さない=実時計。
    const failed = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch,
    });
    expect(failed).toMatchObject({ status: 'delivery_failed' });
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(1);
    // 2手順目は送っていないことが決まり、貸出も返っている。
    expect(raw.prepare(
      `SELECT status, needs_reconcile AS needsReconcile, owner,
              lease_expires_at AS leaseExpiresAt
         FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND step_key = '1:w2'`,
    ).get(reserved.redemption.id)).toMatchObject({
      status: 'started', needsReconcile: 0, owner: null, leaseExpiresAt: null,
    });

    // **失敗した直後にやり直す。時計は進めない。**
    const retried = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch,
    });
    expect(retried.status).toBe('succeeded');
    // 前半は送り直さない。後半だけ送り直す。空振りもしない。
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(2);
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`,
    ).get()).toEqual({ count: 1 });
  });
});

/*
 * 監査 R361・R362・R344 の実D1試験。予約から配送・返却まで本物の
 * SQL で通し、残高・内訳・台帳の数が1回ずつ合うことを確かめる。
 */
describe('部分受け渡しの返却・返却の重なり・再試行期限(実D1)', () => {
  /*
   * R361: 2手順目で失敗しても、渡し終えた1手順目がある交換は
   * 全額返却しない。未完了の手順だけやり直せる。
   * （直す前は refunded・残高1000に戻り、タグ1に相当する送信だけ残った）
   */
  it('一部の手順を渡した交換は全額返却せず、残りだけやり直せる', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    seedTwoStepAction(raw);
    const rewardId = await seedRefundTwoStepReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-partial-refund', requestFingerprint: 'fp-partial-refund',
    });

    // 1手順目は通る。2手順目は最初だけ断る。
    const counter = countFetchesByHost((host, calls) => (
      host === 'example.org' && calls === 1
        ? new Response('ng', { status: 500 })
        : new Response('{}', { status: 200 })
    ));
    const failed = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch,
    });
    expect(failed).toMatchObject({ status: 'delivery_failed' });
    expect(failed.message ?? '').toContain('渡し済み');
    // 全額は戻さない。失敗のまま残し、やり直せる。
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivery_failed' });
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'reversal'`,
    ).get()).toEqual({ count: 0 });

    // やり直しは未完了の2手順目だけ送る。1手順目は増えない。
    const retried = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: counter.fetch,
    });
    expect(retried.status).toBe('succeeded');
    expect(counter.count('example.com')).toBe(1);
    expect(counter.count('example.org')).toBe(2);
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'reversal'`,
    ).get()).toEqual({ count: 0 });
  });

  /*
   * R362: 自動返却と再試行が重なっても、返却の台帳・残高・ロット復元は
   * 各1回。成功へ移った交換には遅い返却が書き込まれない。
   */
  it('返却を重ねても内訳は二重に戻らず、成功済みには返却できない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedRefundWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-double-refund', requestFingerprint: 'fp-double-refund',
    });

    // 受信先が断り続け、自動返却まで進む。
    const refuse = countFetchesByHost(() => new Response('ng', { status: 500 }));
    const failed = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: refuse.fetch,
    });
    expect(failed).toMatchObject({ status: 'delivery_failed' });
    expect(raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'refunded' });
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 1000 });

    // 遅れた返却をもう一度呼んでも、内訳は増えない。
    await refundMileageRewardRedemption(db, {
      redemptionId: reserved.redemption.id, reason: '遅れた返却',
    });
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 1000 });
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger
        WHERE source = 'mileage_reward_refund' AND source_event_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ count: 1 });

    // 成功へ移った交換には、遅い返却は書き込めない。
    const second = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-late-refund', requestFingerprint: 'fp-late-refund',
    });
    const accept = countFetchesByHost(() => new Response('{}', { status: 200 }));
    const succeeded = await deliverMileageReward(db, second.redemption.id, {
      fetch: accept.fetch,
    });
    expect(succeeded.status).toBe('succeeded');
    await expect(refundMileageRewardRedemption(db, {
      redemptionId: second.redemption.id, reason: '遅れた返却',
    })).rejects.toThrow('すでに特典を渡した交換は返金できません');
    expect(await getMileageRedemption(db, second.redemption.id)).toMatchObject({ status: 'succeeded' });
    expect(raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
  });

  /*
   * R344: 最初の送信から24時間を過ぎた手順は、同じキーで送り直さない。
   * 期限内（23時間59分59秒）のやり直しは送って回復する。
   */
  it('24時間を過ぎた手順は送らず、期限内は送って回復する', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const rewardId = await seedWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'e2e-retry-key-expiry', requestFingerprint: 'fp-retry-key-expiry',
    });

    // 初回は受信先が断る。送っていないことが決まり、証言は消える。
    const refuse = countFetchesByHost(() => new Response('ng', { status: 500 }));
    const first = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: refuse.fetch,
    });
    expect(first).toMatchObject({ status: 'delivery_failed' });
    expect(refuse.total()).toBe(1);

    const backdateHours = (hours: number): string => {
      const now = Date.now() - hours * 3_600_000;
      return new Date(now).toISOString();
    };
    // 手順の生まれを25時間前にする。期限切れの道を通す。
    raw.prepare(
      `UPDATE mileage_redemption_step_deliveries SET created_at = ? WHERE redemption_id = ?`,
    ).run(backdateHours(25), reserved.redemption.id);
    const accept = countFetchesByHost(() => new Response('{}', { status: 200 }));
    const expired = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: accept.fetch,
    });
    // 送らない。1回目の1通のまま。
    expect(accept.total()).toBe(0);
    expect(expired).toMatchObject({ status: 'delivery_failed' });
    expect(expired.message ?? '').toContain('24時間');

    // 手順の生まれを23時間59分59秒前に戻す。期限内の道を通す。
    raw.prepare(
      `UPDATE mileage_redemption_step_deliveries SET created_at = ? WHERE redemption_id = ?`,
    ).run(new Date(Date.now() - (24 * 3_600_000 - 1000)).toISOString(), reserved.redemption.id);
    // 期限切れの確定で delivering へ進んでいるため、失敗中に戻して押す。
    raw.prepare(
      `UPDATE mileage_redemptions
          SET status = 'delivery_failed', updated_at = '2020-01-01T00:00:00.000Z',
              next_retry_at = '2020-01-01T00:00:00.000Z', failure_code = NULL, failure_message = NULL
        WHERE id = ?`,
    ).run(reserved.redemption.id);
    const recovered = await deliverMileageReward(db, reserved.redemption.id, {
      fetch: accept.fetch,
    });
    expect(recovered.status).toBe('succeeded');
    expect(accept.total()).toBe(1);
  });
});

describe('R362 返却中断後の回復(実D1)', () => {
  /*
   * 返却確定 UPDATE だけ成功し、台帳・ロット・コード解放の batch が
   * 中断した取り残しを再現する。cron は拾わず、やり直しは409、
   * 要対応にも出ない（直す前は残高700のまま恒久的に止まる＝赤）。
   */
  async function seedStuckRefund(db: D1Database, raw: Database.Database, suffix: string) {
    const rewardId = await seedRefundWebhookReward(db);
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: `e2e-stuck-refund-${suffix}`, requestFingerprint: `fp-stuck-${suffix}`,
    });
    const now = new Date().toISOString();
    raw.prepare(
      `UPDATE mileage_redemptions
          SET status = 'refunded', refunded_at = ?, next_retry_at = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(now, now, reserved.redemption.id);
    return reserved.redemption.id;
  }

  async function seedStuckCouponRefund(db: D1Database, raw: Database.Database, suffix: string) {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: `返却あり券-${suffix}`, rewardKind: 'coupon', requiredMiles: 300, failurePolicy: 'refund' },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id,
      lineAccountId: 'account-1',
      codes: [{ ciphertext: `encrypted-${suffix}`, fingerprint: `fingerprint-${suffix}` }],
    });
    const rewardId = (await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' })).id;
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: `e2e-stuck-coupon-${suffix}`, requestFingerprint: `fp-stuck-coupon-${suffix}`,
    });
    const now = new Date().toISOString();
    raw.prepare(
      `UPDATE mileage_redemptions
          SET status = 'refunded', refunded_at = ?, next_retry_at = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(now, now, reserved.redemption.id);
    return reserved.redemption.id;
  }

  function walletOf(raw: Database.Database): number {
    return (raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get() as { available: number }).available;
  }

  function reversalCount(raw: Database.Database, redemptionId: string): number {
    return (raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_ledger
        WHERE source = 'mileage_reward_refund' AND source_event_id = ?`,
    ).get(redemptionId) as { count: number }).count;
  }

  function lotsRemaining(raw: Database.Database): number {
    return (raw.prepare(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS total FROM mileage_grant_lots
        WHERE beneficiary_key = 'user:user-1' AND status != 'void'`,
    ).get() as { total: number }).total;
  }

  it('中断位置「確定後・書き込み前」：再開で残高・台帳・ロットが各1回一致する', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckRefund(db, raw, 'pos');

    // 取り残しの姿：refunded だが残高700・台帳なし・ロット未復旧。
    expect(await getMileageRedemption(db, id)).toMatchObject({ status: 'refunded' });
    expect(walletOf(raw)).toBe(700);
    expect(reversalCount(raw, id)).toBe(0);
    expect(lotsRemaining(raw)).toBe(700);
    expect(await isMileageRefundComplete(db, id)).toBe(false);
    expect(await findIncompleteMileageRefunds(db, {})).toHaveLength(1);

    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '再開' });

    expect(walletOf(raw)).toBe(1000);
    expect(reversalCount(raw, id)).toBe(1);
    expect(lotsRemaining(raw)).toBe(1000);
    expect(await isMileageRefundComplete(db, id)).toBe(true);
    expect(await findIncompleteMileageRefunds(db, {})).toHaveLength(0);

    // もう一度呼んでも何も増えない（二重に戻さない）。
    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '遅れた返却' });
    expect(walletOf(raw)).toBe(1000);
    expect(reversalCount(raw, id)).toBe(1);
    expect(lotsRemaining(raw)).toBe(1000);
  });

  it('同時再開：2件が重なっても台帳・残高・ロット復元は各1回', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckRefund(db, raw, 'race');

    await Promise.all([
      refundMileageRewardRedemption(db, { redemptionId: id, reason: '再開1' }),
      refundMileageRewardRedemption(db, { redemptionId: id, reason: '再開2' }),
    ]);

    expect(walletOf(raw)).toBe(1000);
    expect(reversalCount(raw, id)).toBe(1);
    expect(lotsRemaining(raw)).toBe(1000);
  });

  it('cron が取り残しを拾って残高まで回復する', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckRefund(db, raw, 'cron');

    const swept = await processDueMileageRewardDeliveries(db, {
      now: new Date().toISOString(),
    });
    expect(swept).toMatchObject({ processed: 1, recovered: 1, failed: 0 });
    expect(walletOf(raw)).toBe(1000);
    expect(reversalCount(raw, id)).toBe(1);
    expect(await getMileageRedemption(db, id)).toMatchObject({ status: 'refunded' });

    // 次の cron は何もしない。
    const sweptAgain = await processDueMileageRewardDeliveries(db, {
      now: new Date().toISOString(),
    });
    expect(sweptAgain).toMatchObject({ processed: 0, recovered: 0, failed: 0 });
    expect(walletOf(raw)).toBe(1000);
  });

  it('配送の呼び出しは送り直さず、欠けた書き込みを足して従来の案内を返す', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckRefund(db, raw, 'delivery');
    const never = countFetchesByHost(() => new Response('{}', { status: 200 }));

    const result = await deliverMileageReward(db, id, { fetch: never.fetch });

    expect(result).toMatchObject({
      status: 'delivery_failed', message: '交換したマイルは戻されています。',
    });
    expect(never.total()).toBe(0);
    expect(walletOf(raw)).toBe(1000);
    expect(reversalCount(raw, id)).toBe(1);
  });

  it('要対応一覧に取り残しが出て、回復後は消える。完了済みは出ない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const stuck = await seedStuckRefund(db, raw, 'list');

    const before = await listMileageRedemptions(db, {
      lineAccountId: 'account-1', status: 'needs_attention', limit: 20, offset: 0,
    });
    expect(before.items.map((item) => item.id)).toContain(stuck);

    await recoverIncompleteMileageRefunds(db, {});
    const after = await listMileageRedemptions(db, {
      lineAccountId: 'account-1', status: 'needs_attention', limit: 20, offset: 0,
    });
    expect(after.items.map((item) => item.id)).not.toContain(stuck);
  });

  it('券の返却：中断再開でコード解放まで含めて各1回', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckCouponRefund(db, raw, 'code');

    expect(walletOf(raw)).toBe(700);
    expect(await isMileageRefundComplete(db, id)).toBe(false);

    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '再開' });

    expect(walletOf(raw)).toBe(1000);
    expect(reversalCount(raw, id)).toBe(1);
    expect(lotsRemaining(raw)).toBe(1000);
    expect(raw.prepare(
      `SELECT status, redemption_id FROM mileage_reward_codes WHERE redemption_id = ?`,
    ).get(id)).toBeUndefined();
    expect(raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_reward_codes WHERE status = 'available'`,
    ).get()).toEqual({ count: 1 });
    expect(await isMileageRefundComplete(db, id)).toBe(true);
  });

  it('旧処理の残り「台帳あり・コード未解放」：ロットを1回だけ直して台帳は増やさない', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckCouponRefund(db, raw, 'legacy');
    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '再開' });
    expect(reversalCount(raw, id)).toBe(1);
    expect(walletOf(raw)).toBe(1000);

    // 旧処理の batch 失敗を再現：台帳と残高は残し、ロットとコードだけ巻き戻す。
    const codeId = (raw.prepare(
      `SELECT id FROM mileage_reward_codes WHERE status = 'available'`,
    ).get() as { id: string }).id;
    raw.prepare(
      `UPDATE mileage_grant_lots SET remaining_amount = remaining_amount - 300
        WHERE beneficiary_key = 'user:user-1' AND status != 'void'`,
    ).run();
    raw.prepare(
      `UPDATE mileage_reward_codes
          SET status = 'reserved', redemption_id = ?, reserved_at = ?
        WHERE id = ?`,
    ).run(id, new Date().toISOString(), codeId);
    expect(lotsRemaining(raw)).toBe(700);

    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '照合' });

    expect(reversalCount(raw, id)).toBe(1);
    expect(walletOf(raw)).toBe(1000);
    expect(lotsRemaining(raw)).toBe(1000);
    expect(raw.prepare(
      `SELECT status FROM mileage_reward_codes WHERE id = ?`,
    ).get(codeId)).toEqual({ status: 'available' });
  });

  it('旧処理の残りに同時修復が重なっても内訳は1回分だけ戻る', async () => {
    // 原子な D1 口（packages/db の試験口）で当て、本物の直列化を見る。
    // worker の試験口は入れ子の書込失敗を投げるため、同時修復の
    // 判定には使わない（環境の失敗を製品の合格としない）。
    const { raw } = createTestD1();
    const db = asD1(raw);
    seedAccount(raw);
    const id = await seedStuckCouponRefund(db, raw, 'concurrent-legacy');
    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '最初の回復' });
    const codeId = (raw.prepare(
      `SELECT id FROM mileage_reward_codes WHERE status = 'available'`,
    ).get() as { id: string }).id;
    raw.prepare(
      `UPDATE mileage_grant_lots SET remaining_amount = remaining_amount - 300
        WHERE beneficiary_key = 'user:user-1' AND status != 'void'`,
    ).run();
    raw.prepare(
      `UPDATE mileage_reward_codes
          SET status = 'reserved', redemption_id = ?, reserved_at = ?
        WHERE id = ?`,
    ).run(id, '2026-09-30T12:00:00.000Z', codeId);
    // 後の通常の交換で内訳に余白を作り、同時修復の直列化を見る。
    const nextReward = await seedRefundWebhookReward(db);
    await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: nextReward,
      idempotencyKey: 'second-spend', requestFingerprint: 'second-spend',
    });
    raw.prepare('UPDATE mileage_redemptions SET updated_at = ? WHERE id = ?').run(
      '2026-09-30T12:00:00.000Z', id,
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
    try {
      const results = await Promise.allSettled([
        refundMileageRewardRedemption(db, { redemptionId: id, reason: 'race-a' }),
        refundMileageRewardRedemption(db, { redemptionId: id, reason: 'race-b' }),
      ]);
      // 両方とも受け付けるが、台帳・残高・内訳の書き込みは合計1回分。
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
      expect(walletOf(raw)).toBe(700);
      expect(reversalCount(raw, id)).toBe(1);
      expect(lotsRemaining(raw)).toBe(700);
    } finally {
      vi.useRealTimers();
      raw.close();
    }
  });

  it('内訳の読み直しが遅れた修復が重なっても内訳は1回分だけ戻る', async () => {
    // Bがコードを読んだ後、内訳の読み直しで待たせ、その間にAを
    // 完了させる。Bが新しい内訳値で条件を作り直しても、書き込み時の
    // コード所有の条件で止まり、合計は1回分になる。
    const { raw } = createTestD1();
    const db = asD1(raw);
    seedAccount(raw);
    const id = await seedStuckCouponRefund(db, raw, 'staggered-legacy');
    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '最初の回復' });
    const codeId = (raw.prepare(
      `SELECT id FROM mileage_reward_codes WHERE status = 'available'`,
    ).get() as { id: string }).id;
    raw.prepare(
      `UPDATE mileage_grant_lots SET remaining_amount = remaining_amount - 300
        WHERE beneficiary_key = 'user:user-1' AND status != 'void'`,
    ).run();
    raw.prepare(
      `UPDATE mileage_reward_codes
          SET status = 'reserved', redemption_id = ?, reserved_at = ?
        WHERE id = ?`,
    ).run(id, '2026-09-30T12:00:00.000Z', codeId);
    const nextReward = await seedRefundWebhookReward(db);
    await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: nextReward,
      idempotencyKey: 'staggered-spend', requestFingerprint: 'staggered-spend',
    });
    let release!: () => void;
    let hit!: () => void;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { hit = resolve; });
    let paused = false;
    const lagDb = {
      ...db,
      prepare(sql: string) {
        const stmt = db.prepare(sql);
        if (!sql.includes('SELECT ledger_entry_id, remaining_amount FROM mileage_grant_lots')) {
          return stmt;
        }
        const wrap = (st: any): any => ({
          ...st,
          bind: (...args: unknown[]) => wrap(st.bind(...args)),
          all: async () => {
            if (!paused) {
              paused = true;
              hit();
              await pause;
            }
            return st.all();
          },
        });
        return wrap(stmt);
      },
    } as D1Database;
    try {
      const delayed = refundMileageRewardRedemption(lagDb, { redemptionId: id, reason: 'delayed' });
      await reached;
      await refundMileageRewardRedemption(db, { redemptionId: id, reason: 'first' });
      release();
      await delayed;
      expect(walletOf(raw)).toBe(700);
      expect(reversalCount(raw, id)).toBe(1);
      expect(lotsRemaining(raw)).toBe(700);
    } finally {
      release();
      raw.close();
    }
  });

  it('旧処理の残りは取り残しと要対応一覧に出て回復後は消える', async () => {
    const { db, raw } = createTestD1();
    seedAccount(raw);
    const id = await seedStuckCouponRefund(db, raw, 'discover-legacy');
    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '最初の回復' });
    const codeId = (raw.prepare(
      `SELECT id FROM mileage_reward_codes WHERE status = 'available'`,
    ).get() as { id: string }).id;
    raw.prepare(
      `UPDATE mileage_grant_lots SET remaining_amount = remaining_amount - 300
        WHERE beneficiary_key = 'user:user-1' AND status != 'void'`,
    ).run();
    raw.prepare(
      `UPDATE mileage_reward_codes
          SET status = 'reserved', redemption_id = ?, reserved_at = ?
        WHERE id = ?`,
    ).run(id, '2026-09-30T12:00:00.000Z', codeId);

    // 台帳はあるが内訳とコードが戻っていないため、未完了のまま見つかる。
    expect(await isMileageRefundComplete(db, id)).toBe(false);
    const recovery = await findIncompleteMileageRefunds(db, { lineAccountId: 'account-1' });
    expect(recovery.map((item) => item.id)).toContain(id);
    const listed = await listMileageRedemptions(db, { lineAccountId: 'account-1', limit: 50, offset: 0 });
    expect(listed.items.map((item) => item.id)).toContain(id);

    // 明示IDの修復で完了し、取り残しと一覧から消える。台帳は増えない。
    await refundMileageRewardRedemption(db, { redemptionId: id, reason: '照合' });
    expect(await isMileageRefundComplete(db, id)).toBe(true);
    expect(reversalCount(raw, id)).toBe(1);
    expect(lotsRemaining(raw)).toBe(1000);
    const recoveryAfter = await findIncompleteMileageRefunds(db, { lineAccountId: 'account-1' });
    expect(recoveryAfter.map((item) => item.id)).not.toContain(id);
    const listedAfter = await listMileageRedemptions(db, { lineAccountId: 'account-1', limit: 50, offset: 0 });
    expect(listedAfter.items.map((item) => item.id)).not.toContain(id);
    raw.close();
  });
});
