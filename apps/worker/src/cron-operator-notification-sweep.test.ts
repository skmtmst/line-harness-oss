/*
 * N-327 (#663): cron から運用者通知の送り残しが実際に回収されることを、
 * 実 SQLite と**実の scheduled ハンドラ**で見張る。
 *
 * ここで止めたい崩れ方:
 *   1. 回収の口はあるが cron から呼ばれず、retry_wait の行が溜まったまま。
 *      (「公開したのに届かない」が、繋がっていないからではなく起きる)
 *   2. 配信レーン以外の cron でも回ってしまい、重い処理の tick を食う。
 *   3. 同じ行を2つの実行が同時に掴んで二重に送る。
 *   4. 1回の取り分の上限が効かず、1 tick が無限に伸びる／古い行が後回しに
 *      され続ける。
 *
 * source 文字列ではなく `worker.scheduled()` を本当に呼ぶ。cron-config-
 * consistency.test.ts は「どのレーンに書いてあるか」を見張る係で、ここは
 * 「呼んだら本当に捌けるか」を見張る係。
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestD1, type SqliteD1 } from './test-utils/d1-sqlite.js';

const pushMessageWithRequestId = vi.hoisted(() => vi.fn());
const sendOperationEmail = vi.hoisted(() => vi.fn());
const processOperationNotificationOutbox = vi.hoisted(() => vi.fn());

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessageWithRequestId = pushMessageWithRequestId;
  },
}));
vi.mock('./services/operation-notifications.js', () => ({
  sendOperationEmail,
  processOperationNotificationOutbox,
}));

const { default: worker } = await import('./index.js');
const { OPERATOR_NOTIFICATION_SWEEP_LIMIT, sweepOperatorNotifications } = await import(
  './services/operator-notification-dispatch.js'
);
const { SCHEDULED_CRONS } = await import('./services/scheduled-job-isolation.js');

const ACCOUNT = 'account-1';
/** 固定時刻。`next_retry_at` の過去/未来を時計に依存させない。 */
const NOW = new Date('2026-11-02T03:00:00.000Z');

function seed(db: SqliteD1): void {
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('${ACCOUNT}', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
  db.raw.prepare(`
    INSERT INTO staff_members
      (id, name, email, role, api_key, line_user_id, email_verified_at,
       assigned_line_account_id, account_scope, tenant_id, is_active)
    VALUES ('owner-1', 'オーナー', 'owner@example.test', 'owner', 'key-owner',
            'U-owner', '2026-09-07T10:00:00+09:00', '${ACCOUNT}', 'all', 'tenant-1', 1)
  `).run();
  db.raw.prepare(`
    INSERT INTO notification_rules (id, name, event_type, conditions, channels, line_account_id, is_active)
    VALUES ('rule-1', '新しい予約', 'booking_created', '{}', '["line"]', '${ACCOUNT}', 1)
  `).run();
}

/**
 * 送り残しの行を1件作る。
 * @param nextRetryAt この時刻を過ぎていれば回収の対象になる
 */
function seedStuckDelivery(
  db: SqliteD1,
  id: string,
  options: { nextRetryAt: string; queuedAt: string },
): void {
  db.raw.prepare(`
    INSERT INTO notification_instances
      (id, line_account_id, audience_type, definition_id, source_event_type, source_event_id,
       source_metadata_json, dedupe_key, status, created_at, updated_at)
    VALUES (?, ?, 'operator', 'rule-1', 'booking_created', ?, ?, ?, 'pending', ?, ?)
  `).run(
    `instance-${id}`, ACCOUNT, `booking-${id}`,
    JSON.stringify({ message: '新しい予約が入りました', ruleName: '新しい予約', channels: ['line'] }),
    `dedupe-${id}`, options.queuedAt, options.queuedAt,
  );
  db.raw.prepare(`
    INSERT INTO notification_deliveries
      (id, line_account_id, instance_id, audience_type, recipient_type, recipient_id,
       channel, idempotency_key, status, retryable, attempts, next_retry_at,
       queued_at, execution_mode, version, updated_at)
    VALUES (?, ?, ?, 'operator', 'staff', 'owner-1', 'line', ?, 'retry_wait', 1, 1, ?, ?, 'automatic', 1, ?)
  `).run(
    id, ACCOUNT, `instance-${id}`, `key-${id}`,
    options.nextRetryAt, options.queuedAt, options.queuedAt,
  );
}

function deliveryRow(db: SqliteD1, id: string) {
  return db.raw.prepare(
    `SELECT status, attempts, provider_request_id FROM notification_deliveries WHERE id = ?`,
  ).get(id) as { status: string; attempts: number; provider_request_id: string | null };
}

function scheduledEvent(cron: string): ScheduledEvent {
  return {
    cron,
    scheduledTime: NOW.getTime(),
    type: 'scheduled',
    noRetry: () => undefined,
    waitUntil: () => undefined,
  } as unknown as ScheduledEvent;
}

function execCtx(): ExecutionContext {
  return {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
}

function workerEnv(db: SqliteD1) {
  return {
    DB: db.db,
    LINE_CHANNEL_ACCESS_TOKEN: 'token-1',
    WORKER_URL: 'https://worker.example.test',
  } as unknown as Parameters<typeof worker.scheduled>[1];
}

describe('N-327 #663 cron からの運用者通知の回収', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-request-1' });
    sendOperationEmail.mockReset();
    sendOperationEmail.mockResolvedValue(undefined);
    processOperationNotificationOutbox.mockReset();
    processOperationNotificationOutbox.mockResolvedValue(undefined);
    testDb = createTestD1();
    seed(testDb);
  });

  it('配信レーンの cron を回すと、期限の来た retry_wait が実際に捌ける', async () => {
    seedStuckDelivery(testDb, 'delivery-1', {
      nextRetryAt: '2026-11-02T02:55:00.000Z', // NOW より前 = 期限到来
      queuedAt: '2026-11-02T02:50:00.000Z',
    });
    expect(deliveryRow(testDb, 'delivery-1').status).toBe('retry_wait');

    await worker.scheduled!(scheduledEvent(SCHEDULED_CRONS.delivery), workerEnv(testDb), execCtx());

    expect(pushMessageWithRequestId).toHaveBeenCalledTimes(1);
    const row = deliveryRow(testDb, 'delivery-1');
    expect(row.status).toBe('provider_accepted');
    expect(row.provider_request_id).toBe('line-request-1');
  });

  it('まだ期限の来ていない retry_wait は、cron を回しても触らない', async () => {
    seedStuckDelivery(testDb, 'delivery-future', {
      nextRetryAt: '2026-11-02T03:20:00.000Z', // NOW より後
      queuedAt: '2026-11-02T02:50:00.000Z',
    });

    await worker.scheduled!(scheduledEvent(SCHEDULED_CRONS.delivery), workerEnv(testDb), execCtx());

    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(deliveryRow(testDb, 'delivery-future').status).toBe('retry_wait');
  });

  it('重い処理のレーンでは回収しない（配信レーンに載せている）', async () => {
    seedStuckDelivery(testDb, 'delivery-1', {
      nextRetryAt: '2026-11-02T02:55:00.000Z',
      queuedAt: '2026-11-02T02:50:00.000Z',
    });

    await worker.scheduled!(
      scheduledEvent(SCHEDULED_CRONS.sixHourlyHeavy), workerEnv(testDb), execCtx(),
    );

    expect(pushMessageWithRequestId).not.toHaveBeenCalled();
    expect(deliveryRow(testDb, 'delivery-1').status).toBe('retry_wait');
  });

  it('1回の取り分は上限までで、古い行から先に捌く（先入れ先出し）', async () => {
    // 上限より1件多く積む。積んだ順と逆の id にして、id 順ではなく
    // queued_at 順で選ばれていることを見る。
    const total = OPERATOR_NOTIFICATION_SWEEP_LIMIT + 1;
    // queued_at は1秒ずつ新しくなる。id は逆順に振るので、id 順に選んで
    // いたら「一番古い行」の表明が落ちる。
    const oldest = Date.parse('2026-11-02T02:00:00.000Z');
    for (let index = 0; index < total; index += 1) {
      seedStuckDelivery(testDb, `delivery-${String(total - index).padStart(3, '0')}`, {
        nextRetryAt: '2026-11-02T02:55:00.000Z',
        queuedAt: new Date(oldest + index * 1_000).toISOString(),
      });
    }

    // cron を実際に回す。index.ts が渡している上限そのものを見張るので、
    // 上限を小さくしたり渡し忘れたりすると、ここが落ちる。
    await worker.scheduled!(scheduledEvent(SCHEDULED_CRONS.delivery), workerEnv(testDb), execCtx());

    expect(pushMessageWithRequestId).toHaveBeenCalledTimes(OPERATOR_NOTIFICATION_SWEEP_LIMIT);
    // あふれた1件は落ちていない。**残るのは一番新しい行**でなければならない。
    // 件数だけを数えると、新しい順に捌いて古い行を置き去りにしても緑になる。
    const leftover = testDb.raw.prepare(
      `SELECT id FROM notification_deliveries WHERE status = 'retry_wait'`,
    ).all() as Array<{ id: string }>;
    expect(leftover.map((row) => row.id)).toEqual(['delivery-001']);
    // 一番古い行(queued_at が最小 = id は最大)は最初の tick で捌けている。
    expect(deliveryRow(testDb, `delivery-${String(total).padStart(3, '0')}`).status)
      .toBe('provider_accepted');

    const second = await sweepOperatorNotifications(testDb.db, {} as never, {
      limit: OPERATOR_NOTIFICATION_SWEEP_LIMIT,
      now: new Date(NOW.getTime() + 5 * 60_000),
    });
    expect(second.swept).toBe(1);
  });
});

describe('N-327 #663 回収が同時に2回走っても二重に送らない', () => {
  let dir: string;
  let file: string;
  let owner: SqliteD1;

  beforeEach(() => {
    pushMessageWithRequestId.mockReset();
    pushMessageWithRequestId.mockResolvedValue({ data: {}, requestId: 'line-request-1' });
    dir = mkdtempSync(join(tmpdir(), 'operator-sweep-'));
    file = join(dir, 'sweep.sqlite');
    owner = createTestD1({ file });
    seed(owner);
    seedStuckDelivery(owner, 'delivery-1', {
      nextRetryAt: '2026-11-02T02:55:00.000Z',
      queuedAt: '2026-11-02T02:50:00.000Z',
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('別々の接続で同時に回しても、送信は1回・行は1回だけ進む', async () => {
    // 同じファイルDBへ2本の接続を開く。手書きのモックではなく実SQLiteなので、
    // 条件つきUPDATEの changes が本当に1/0に割れるところを見られる。
    const runnerA = createTestD1({ file, attach: true });
    const runnerB = createTestD1({ file, attach: true });

    const [resultA, resultB] = await Promise.all([
      sweepOperatorNotifications(runnerA.db, {} as never, { limit: 100, now: NOW }),
      sweepOperatorNotifications(runnerB.db, {} as never, { limit: 100, now: NOW }),
    ]);

    // 勝った側だけが1件掴み、負けた側は0件。
    expect([resultA.swept, resultB.swept].sort()).toEqual([0, 1]);
    expect(pushMessageWithRequestId).toHaveBeenCalledTimes(1);
    const row = deliveryRow(owner, 'delivery-1');
    expect(row.status).toBe('provider_accepted');
    // 試行回数も1つしか進んでいない（2回送って2回数えていない）。
    expect(row.attempts).toBe(2);
    const attempts = owner.raw.prepare(
      `SELECT COUNT(*) AS n FROM notification_delivery_attempts WHERE delivery_id = 'delivery-1'`,
    ).get() as { n: number };
    expect(attempts.n).toBe(1);
  });
});
