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
  clearRedemptionStepIntent,
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
});
