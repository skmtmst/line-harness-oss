/*
 * N-101(#622): 友だち追加の webhook を「独立した2つのD1接続」で取り合わせる。
 *
 * 1つの接続で await を挟むだけの並行では、SQL が競合を捌けているかまでは
 * 分からない。ここでは同じDBファイルへ**別々の接続**を開き、2つの実行主体が
 * 同時に follow を処理する。送るのは1回だけで、負けた側は登録も送信も
 * 台帳の上書きもしないことを確かめる。
 */
import { describe, expect, test, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../index.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  replyMessageWithRequestId: vi.fn(),
  pushMessage: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => lineClientMocks),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
  logOutgoingMessage: vi.fn().mockResolvedValue(undefined),
}));

import { verifySignature } from '@line-crm/line-sdk';
import { webhook } from './webhook.js';

/*
 * schema を流すのは重い（実ファイルへ何千ものDDL）。1度だけ雛形を作り、
 * テストごとにその写しを置く。写しは別のファイルなので影響し合わない。
 */
let templateDir: string;
let templateFile: string;
let dir: string;
let file: string;
/** 実行主体A・Bの接続。共有しない。 */
let connA: SqliteD1;
let connB: SqliteD1;
/** 検証用の第3の接続。書き込みには使わない。 */
let observer: Database.Database;

function seedBase(raw: Database.Database): void {
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, allow_concurrent, line_account_id)
     VALUES ('scenario-1', '初回案内', 'friend_add', 1, 'relative', 1, 'account-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
     VALUES ('step-1', 'scenario-1', 0, 0, 'text', 'ようこそ')`,
  ).run();
  raw.prepare(
    `INSERT INTO entry_routes (id, name, ref_code, is_active, line_account_id)
     VALUES ('route-1', '紹介QR', 'REF001', 1, 'account-1')`,
  ).run();
  const definition = JSON.stringify({
    routeIds: ['route-1'], scenarioId: 'scenario-1', messageType: 'scenario',
    messageText: '', timing: 'immediate', actions: [], friendCondition: '',
    activeFrom: null, activeUntil: null, weekdays: [], timeWindows: [],
    resendSuppressionHours: 24,
  });
  raw.prepare(
    `INSERT INTO friend_add_rules
      (id, line_account_id, friend_kind, name, priority, is_unknown_route_fallback,
       status, current_version_id, created_at, updated_at)
     VALUES ('rule-1', 'account-1', 'first_time', '初回案内', 1, 0,
       'published', 'version-1', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
  ).run();
  raw.prepare(
    `INSERT INTO friend_add_rule_versions
      (id, rule_id, version_number, definition_snapshot, status)
     VALUES ('version-1', 'rule-1', 1, ?, 'published')`,
  ).run(definition);
  insertFriend(raw, 'friend-1', {
    line_user_id: 'U-1', line_account_id: 'account-1', unfollow_count: 0, ref_code: 'REF001',
  });
}

async function postFollow(webhookEventId: string, useDb: D1Database): Promise<void> {
  const app = new Hono();
  app.route('/', webhook);
  const waitUntil = vi.fn();
  const response = await app.request('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
    body: JSON.stringify({
      events: [{
        type: 'follow', webhookEventId, timestamp: Date.now(),
        source: { type: 'user', userId: 'U-1' }, replyToken: `reply-${webhookEventId}`,
        follow: { isUnblocked: false },
      }],
    }),
  }, {
    DB: useDb,
    LINE_CHANNEL_SECRET: 'secret-1',
    LINE_CHANNEL_ACCESS_TOKEN: 'token-1',
  } as unknown as Env['Bindings'], {
    waitUntil, passThroughOnException: vi.fn(), props: {},
  } as unknown as ExecutionContext);
  expect(response.status).toBe(200);
  await waitUntil.mock.calls[0]?.[0];
}

function sendCount(): number {
  return lineClientMocks.replyMessage.mock.calls.length + lineClientMocks.pushMessage.mock.calls.length;
}

beforeAll(() => {
  templateDir = mkdtempSync(join(tmpdir(), 'friend-add-webhook-tpl-'));
  templateFile = join(templateDir, 'template.sqlite');
  const setup = createTestD1({ file: templateFile });
  seedBase(setup.raw);
  setup.raw.pragma('wal_checkpoint(TRUNCATE)');
  setup.raw.close();
});

afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'friend-add-webhook-'));
  file = join(dir, 'test.sqlite');
  copyFileSync(templateFile, file);
  connA = createTestD1({ file, attach: true });
  connB = createTestD1({ file, attach: true });
  observer = new Database(file);
  vi.mocked(verifySignature).mockResolvedValue(true);
  lineClientMocks.getProfile.mockResolvedValue({ displayName: 'U-1さん' });
  lineClientMocks.replyMessage.mockResolvedValue(undefined);
  lineClientMocks.pushMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  observer.close();
  connA.raw.close();
  connB.raw.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 予約の貸出を古くする（前の持ち主が止まったように見せる）。 */
const STALE = '2026-09-01T10:00:00.000+09:00';

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function claimRow(): { event_id: string; generation: number; dispatched_at: string | null } | undefined {
  return observer.prepare(
    `SELECT event_id, generation, dispatched_at FROM friend_add_send_claims`,
  ).get() as { event_id: string; generation: number; dispatched_at: string | null } | undefined;
}

function eventRow(webhookEventId: string): { routing_status: string; delivery_count: number; error_code: string | null } {
  return observer.prepare(
    `SELECT routing_status, delivery_count, error_code FROM friend_add_events WHERE webhook_event_id = ?`,
  ).get(webhookEventId) as { routing_status: string; delivery_count: number; error_code: string | null };
}

function seedIntroTemplate(): void {
  observer.prepare(
    `INSERT INTO message_templates (id, name, message_type, message_content)
     VALUES ('tpl-1', '紹介あいさつ', 'text', '{"text":"ご紹介ありがとうございます"}')`,
  ).run();
  observer.prepare(`UPDATE entry_routes SET intro_template_id = 'tpl-1' WHERE id = 'route-1'`).run();
}

describe('POST /webhook — 独立2接続の並行follow (#622)', () => {
  test('別接続の2実行が同時に届いても、送るのは1回だけ', async () => {
    // 送信を遅らせて競合の窓を広げる。
    lineClientMocks.replyMessage.mockImplementation(
      async () => { await new Promise((resolve) => setTimeout(resolve, 50)); },
    );
    await Promise.all([
      postFollow('webhook-a', connA.db),
      postFollow('webhook-b', connB.db),
    ]);

    expect(sendCount()).toBe(1);
    const rows = observer.prepare(
      `SELECT routing_status, delivery_count, error_code FROM friend_add_events ORDER BY webhook_event_id`,
    ).all() as Array<{ routing_status: string; delivery_count: number; error_code: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.routing_status).sort()).toEqual(['completed', 'suppressed']);
    const completed = rows.find((row) => row.routing_status === 'completed')!;
    expect(completed).toMatchObject({ delivery_count: 1, error_code: null });
    const deferred = rows.find((row) => row.routing_status === 'suppressed')!;
    expect(deferred).toMatchObject({ delivery_count: 0, error_code: 'duplicate_in_flight' });
    // 登録も1本だけ（負けた側は登録を作らない）
    expect(observer.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get()).toEqual({ n: 1 });
    // 予約のゴミを残さない
    expect(observer.prepare(`SELECT COUNT(*) AS n FROM friend_add_send_claims`).get()).toEqual({ n: 0 });
  });

  /*
   * 核心の逆交差。**旧Aを送信の途中で止めたまま、新Bを最後まで走らせ、
   * そのあと旧Aも最後まで走らせる。** Bは貸出が古いので予約を奪えるが、
   * Aが立てた「送り始めた」印が残っているので送らない。Aは送り終えるが、
   * 世代が進んでいるので台帳も後続の外部効果も行わない。届くのは1通。
   */
  describe.each([
    { label: '正: Aが先に予約', first: 'a', second: 'b' },
    { label: '逆: Bが先に予約', first: 'b', second: 'a' },
  ])('$label', ({ first, second }) => {
    test('送信中に奪われても、双方合わせて送るのは1回だけ', async () => {
      seedIntroTemplate();
      const firstDb = first === 'a' ? connA.db : connB.db;
      const secondDb = second === 'a' ? connA.db : connB.db;
      const midSend = makeDeferred();
      const releaseSend = makeDeferred();

      lineClientMocks.replyMessage.mockImplementation(async () => {
        // 送信の最中に貸出が古くなる（実行が長く止まった状況）。
        observer.prepare(`UPDATE friend_add_send_claims SET claimed_at = ?`).run(STALE);
        midSend.resolve();
        await releaseSend.promise;
      });

      // 旧: 送信の途中で待たせる
      const older = postFollow(`webhook-${first}`, firstDb);
      await midSend.promise;

      // 印が立っていることを確かめてから、新を最後まで走らせる
      expect(claimRow()?.dispatched_at).not.toBeNull();
      await postFollow(`webhook-${second}`, secondDb);

      // 新は予約を奪えたが、印が残っているので送らない
      expect(sendCount()).toBe(1);
      expect(claimRow()).toMatchObject({ event_id: expect.any(String), generation: 2 });
      expect(eventRow(`webhook-${second}`)).toMatchObject({
        routing_status: 'suppressed', delivery_count: 0, error_code: 'delivery_unknown',
      });

      // 旧も最後まで走らせる。送り終えるが、台帳も後続の案内も行わない。
      releaseSend.resolve();
      await older;

      expect(sendCount()).toBe(1);
      expect(lineClientMocks.pushMessage.mock.calls.length).toBe(0);
      expect(eventRow(`webhook-${first}`)).toMatchObject({ routing_status: 'pending' });
      // 登録は旧の1本だけ。新は作らない。
      expect(observer.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get()).toEqual({ n: 1 });
    });
  });

  test('前の持ち主が送り始めたまま消えたら、奪った側は送らない', async () => {
    observer.prepare(
      `INSERT INTO friend_add_send_claims
        (line_account_id, friend_id, event_id, generation, claimed_at, dispatched_at)
       VALUES ('account-1', 'friend-1', 'webhook-crashed', 1, ?, ?)`,
    ).run(STALE, STALE);

    await postFollow('webhook-new', connB.db);

    expect(sendCount()).toBe(0);
    expect(eventRow('webhook-new')).toMatchObject({
      routing_status: 'suppressed', delivery_count: 0, error_code: 'delivery_unknown',
    });
    expect(observer.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios`).get()).toEqual({ n: 0 });
  });

  test('送り始める前に消えていたら、奪った側が実際に送る', async () => {
    observer.prepare(
      `INSERT INTO friend_add_send_claims
        (line_account_id, friend_id, event_id, generation, claimed_at, dispatched_at)
       VALUES ('account-1', 'friend-1', 'webhook-crashed', 1, ?, NULL)`,
    ).run(STALE);

    await postFollow('webhook-new', connB.db);

    expect(sendCount()).toBe(1);
    expect(eventRow('webhook-new')).toMatchObject({
      routing_status: 'completed', delivery_count: 1, error_code: null,
    });
    // 送り終えたので予約は返す
    expect(observer.prepare(`SELECT COUNT(*) AS n FROM friend_add_send_claims`).get()).toEqual({ n: 0 });
  });

  test('負けた側の実行は、勝った側の台帳の結果を上書きしない', async () => {
    await postFollow('webhook-a', connA.db);
    const winner = observer.prepare(
      `SELECT id, routing_status, delivery_count FROM friend_add_events WHERE webhook_event_id = 'webhook-a'`,
    ).get() as { id: string; routing_status: string; delivery_count: number };
    expect(winner).toMatchObject({ routing_status: 'completed', delivery_count: 1 });

    // 勝った側は予約を返しているので、次の実行は予約を取れる。
    // それでも再送制限（24時間）に当たるため送らない。
    await postFollow('webhook-b', connB.db);
    expect(sendCount()).toBe(1);
    expect(observer.prepare(
      `SELECT routing_status, delivery_count FROM friend_add_events WHERE id = ?`,
    ).get(winner.id)).toEqual({ routing_status: 'completed', delivery_count: 1 });
    expect(observer.prepare(
      `SELECT routing_status, error_code FROM friend_add_events WHERE webhook_event_id = 'webhook-b'`,
    ).get()).toEqual({ routing_status: 'suppressed', error_code: 'resend_suppressed' });
  });

  test('別接続が予約を奪ったあと、旧持ち主は台帳を確定できない', async () => {
    // Aの送信中にBの接続が予約を奪う（処理が長引いてTTLを過ぎた状況）。
    lineClientMocks.replyMessage.mockImplementation(async () => {
      connB.raw.prepare(
        `UPDATE friend_add_send_claims
            SET event_id = 'stolen-by-b', generation = generation + 1`,
      ).run();
    });
    await postFollow('webhook-a', connA.db);

    // 旧持ち主は台帳を書かない（勝った側が書く）
    expect(eventRow('webhook-a')).toMatchObject({ routing_status: 'pending' });
    // 予約は奪った側のまま。旧持ち主は消さない。
    expect(claimRow()).toMatchObject({ event_id: 'stolen-by-b', generation: 2 });
  });
});
