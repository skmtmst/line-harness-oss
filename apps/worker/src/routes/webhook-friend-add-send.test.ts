/*
 * N-101(#622): 友だち追加の送信は1回だけ・送れなかったら再送可能。
 *
 * 実DB・実振り分け・実送信権予約で確かめる。外部LINEへは送らない
 *（line-sdk だけ差し替える）。DBはテスト用D1（better-sqlite3）を使う。
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import type { Env } from '../index.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { isFriendAddResendSuppressed } from '../services/friend-add-routing.js';

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

let testDb: SqliteD1;
let raw: Database.Database;
let db: D1Database;

const env = () => ({
  DB: db,
  LINE_CHANNEL_SECRET: 'secret-1',
  LINE_CHANNEL_ACCESS_TOKEN: 'token-1',
}) as Record<string, unknown>;

function seedBase(): void {
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

async function postFollow(webhookEventId: string, useDb: D1Database = db): Promise<void> {
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
  }, { ...env(), DB: useDb }, { waitUntil, passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext);
  expect(response.status).toBe(200);
  await waitUntil.mock.calls[0]?.[0];
}

function sendCount(): number {
  return lineClientMocks.replyMessage.mock.calls.length + lineClientMocks.pushMessage.mock.calls.length;
}

/**
 * 実D1のまま、指定のSQLに当たった最初の呼び出しだけ壊す差し替え。
 * 「送信はできたがその後のDBが落ちた」を再現する。
 */
function breakOnceOn(useDb: D1Database, needle: string, error: Error): { db: D1Database; calls: () => number } {
  let armed = true;
  let calls = 0;
  const proxy = new Proxy(useDb, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
      return (sql: string) => {
        const statement = ((target.prepare as unknown) as (query: string) => {
          bind: (...args: unknown[]) => Record<string, unknown>;
        })(sql);
        if (!armed || !sql.includes(needle)) return statement;
        return {
          ...statement,
          bind: (...args: unknown[]) => {
            const bound = statement.bind(...args);
            const fail = async () => {
              calls += 1;
              armed = false;
              throw error;
            };
            // RETURNING を使う文は first で走るので、両方を壊す。
            return { ...bound, run: fail, first: fail };
          },
        };
      };
    },
  }) as D1Database;
  return { db: proxy, calls: () => calls };
}

function eventRows(): Array<{ routing_status: string; delivery_count: number; error_code: string | null }> {
  return raw.prepare(
    `SELECT routing_status, delivery_count, error_code FROM friend_add_events ORDER BY id`,
  ).all() as Array<{ routing_status: string; delivery_count: number; error_code: string | null }>;
}

beforeEach(() => {
  testDb = createTestD1();
  raw = testDb.raw;
  db = testDb.db;
  seedBase();
  vi.mocked(verifySignature).mockResolvedValue(true);
  lineClientMocks.getProfile.mockResolvedValue({ displayName: 'U-1さん' });
  lineClientMocks.replyMessage.mockResolvedValue(undefined);
  lineClientMocks.pushMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  testDb.raw.close();
});

describe('POST /webhook — 並行followの単一化 (#622)', () => {
  test('別webhook IDで並行に届いても1回だけ送る', async () => {
    // 送信を遅らせて競合の窓を広げる。それでも1回だけ送る。
    lineClientMocks.replyMessage.mockImplementation(
      async () => { await new Promise((resolve) => setTimeout(resolve, 50)); },
    );
    await Promise.all([postFollow('webhook-a'), postFollow('webhook-b')]);

    const sends = lineClientMocks.replyMessage.mock.calls.length
      + lineClientMocks.pushMessage.mock.calls.length;
    expect(sends).toBe(1);

    const rows = eventRows();
    expect(rows).toHaveLength(2);
    const statuses = rows.map((row) => row.routing_status).sort();
    expect(statuses).toEqual(['completed', 'suppressed']);
    const completed = rows.find((row) => row.routing_status === 'completed')!;
    expect(completed.delivery_count).toBe(1);
    expect(completed.error_code).toBeNull();
    // 取れなかった側は登録自体を作らず抑止として残す
    const deferred = rows.find((row) => row.routing_status === 'suppressed')!;
    expect(deferred.delivery_count).toBe(0);
    expect(deferred.error_code).toBe('duplicate_in_flight');
    // 予約のゴミを残さない
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM friend_add_send_claims`).get()).toEqual({ n: 0 });
  });
});

describe('POST /webhook — 送信後の台帳確定失敗 (#622)', () => {
  test('送ったあと確定に失敗しても別webhookは二重送信しない（送達不明契約）', async () => {
    // 最初の確定UPDATEだけ壊す。送信は通るが台帳は pending のまま残る。
    const sabotage = breakOnceOn(db, 'UPDATE friend_add_events', new Error('DB down after send'));
    await postFollow('webhook-a', sabotage.db);
    expect(sabotage.calls()).toBe(1);
    expect(sendCount()).toBe(1);

    // 送ったが確定できていない。予約は掴んだままにする
    const held = raw.prepare(`SELECT event_id FROM friend_add_send_claims`).get() as { event_id: string };
    const eventA = raw.prepare(
      `SELECT id FROM friend_add_events WHERE webhook_event_id = 'webhook-a'`,
    ).get() as { id: string };
    expect(held).toEqual({ event_id: eventA.id });
    const pending = raw.prepare(
      `SELECT routing_status FROM friend_add_events WHERE id = (SELECT id FROM friend_add_events WHERE webhook_event_id = 'webhook-a')`,
    ).get() as { routing_status: string };
    expect(pending).toEqual({ routing_status: 'pending' });

    // 別のwebhook IDで並行に届いても、予約が掴まれているため送らない
    await postFollow('webhook-b');
    expect(sendCount()).toBe(1);
    const rows = eventRows();
    expect(rows.map((row) => row.routing_status).sort()).toEqual(['pending', 'suppressed']);
    const deferred = rows.find((row) => row.routing_status === 'suppressed')!;
    expect(deferred).toMatchObject({ delivery_count: 0, error_code: 'duplicate_in_flight' });
    // 予約は最初の実行が掴んだまま（確定するまで解放しない）
    expect(raw.prepare(`SELECT event_id FROM friend_add_send_claims`).get()).toEqual({ event_id: eventA.id });
  });
});

describe('POST /webhook — 古い予約と予約失敗 (#622)', () => {
  test('2分過ぎた古い予約は奪い直して送る', async () => {
    raw.prepare(
      `INSERT INTO friend_add_send_claims (line_account_id, friend_id, event_id, generation, claimed_at)
       VALUES ('account-1', 'friend-1', 'webhook-crashed', 1, '2026-09-01T10:00:00.000+09:00')`,
    ).run();
    await postFollow('webhook-new');
    expect(sendCount()).toBe(1);
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ routing_status: 'completed', delivery_count: 1 });
  });

  test('予約を持つ実行がいるときは送らずに引く（旧holder確定）', async () => {
    raw.prepare(
      `INSERT INTO friend_add_send_claims (line_account_id, friend_id, event_id, generation, claimed_at)
       VALUES ('account-1', 'friend-1', 'webhook-holder', 1, '2999-01-01T00:00:00.000+09:00')`,
    ).run();
    await postFollow('webhook-new');
    expect(sendCount()).toBe(0);
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      routing_status: 'suppressed', delivery_count: 0, error_code: 'duplicate_in_flight',
    });
    // 他人の予約はそのまま
    expect(raw.prepare(`SELECT event_id FROM friend_add_send_claims`).get()).toEqual({ event_id: 'webhook-holder' });
  });

  test('予約のDB失敗は送らない（fail-closed）', async () => {
    const sabotage = breakOnceOn(db, 'friend_add_send_claims', new Error('D1 down'));
    await postFollow('webhook-new', sabotage.db);
    expect(sabotage.calls()).toBe(1);
    expect(sendCount()).toBe(0);
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      routing_status: 'suppressed', delivery_count: 0, error_code: 'send_claim_unavailable',
    });
  });
});

describe('POST /webhook — 送信の結末を分ける (#622)', () => {
  test('LINEが断った送信（4xx）は send_failed で残し、次の追加を止めない', async () => {
    const rejected = Object.assign(new Error('LINE API error: 400'), { status: 400 });
    lineClientMocks.replyMessage.mockRejectedValueOnce(rejected);
    lineClientMocks.pushMessage.mockRejectedValue(rejected);
    await postFollow('webhook-fail');

    const sends = lineClientMocks.replyMessage.mock.calls.length
      + lineClientMocks.pushMessage.mock.calls.length;
    expect(sends).toBeGreaterThan(0);
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      routing_status: 'partial_failed', delivery_count: 0, error_code: 'send_failed',
    });

    // 届いていないので cron の再試行に載せる（claim を返す）
    expect(raw.prepare(
      `SELECT status FROM friend_scenarios WHERE friend_id = 'friend-1'`,
    ).get()).toEqual({ status: 'active' });
    // 届いていないと言い切れるので、再送制限は数えない。次の追加で送り直せる。
    await expect(isFriendAddResendSuppressed(db, {
      lineAccountId: 'account-1', friendId: 'friend-1',
      resendSuppressionHours: 24, now: new Date(),
    })).resolves.toBe(false);
    // 予約は返す（次の実行が取れる）
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM friend_add_send_claims`).get()).toEqual({ n: 0 });
  });

  test('通信断のように結末が分からない送信は delivery_unknown にし、自動で送り直さない', async () => {
    // status を持たない例外＝こちらが結果を知らないだけで、届いたかもしれない。
    lineClientMocks.replyMessage.mockRejectedValueOnce(new Error('network timeout'));
    lineClientMocks.pushMessage.mockRejectedValue(new Error('network timeout'));
    await postFollow('webhook-unknown');

    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      routing_status: 'partial_failed', delivery_count: 0, error_code: 'delivery_unknown',
    });

    // 自動再送の対象から外す。送り直すと二重に届く。
    await expect(isFriendAddResendSuppressed(db, {
      lineAccountId: 'account-1', friendId: 'friend-1',
      resendSuppressionHours: 24, now: new Date(),
    })).resolves.toBe(true);
    // cron に送り直させない（届いていたら2通目になる）。1通目は送り終えた扱い。
    // 1通しかないシナリオなので「読み終えた」へ進む。active/delivering に
    // 戻さない＝cronが1通目を拾い直さない。
    expect(raw.prepare(
      `SELECT status FROM friend_scenarios WHERE friend_id = 'friend-1'`,
    ).get()).toEqual({ status: 'completed' });
    // 予約は掴んだまま残す（TTLまで別の実行を止める）
    const claim = raw.prepare(`SELECT event_id FROM friend_add_send_claims`).get() as { event_id: string };
    const event = raw.prepare(
      `SELECT id FROM friend_add_events WHERE webhook_event_id = 'webhook-unknown'`,
    ).get() as { id: string };
    expect(claim).toEqual({ event_id: event.id });
  });

  test('送達不明のあとの再追加は送らず、理由を残す', async () => {
    lineClientMocks.replyMessage.mockRejectedValueOnce(new Error('network timeout'));
    lineClientMocks.pushMessage.mockRejectedValueOnce(new Error('network timeout'));
    await postFollow('webhook-unknown');
    const before = sendCount();

    // 予約のTTLを過ぎさせて「別の実行が取れる」状態にしても、
    // 台帳の送達不明が再送制限として効く。
    raw.prepare(
      `UPDATE friend_add_send_claims SET claimed_at = '2026-09-01T10:00:00.000+09:00'`,
    ).run();
    lineClientMocks.replyMessage.mockResolvedValue(undefined);
    lineClientMocks.pushMessage.mockResolvedValue(undefined);
    await postFollow('webhook-after-unknown');

    expect(sendCount()).toBe(before);
    // 奪い直せても、前の持ち主の「送り始めた」印が残っているので送らない。
    const rows = eventRows();
    const latest = rows.find((row) => row.error_code === 'delivery_unknown' && row.routing_status === 'suppressed');
    expect(latest).toMatchObject({ routing_status: 'suppressed', delivery_count: 0 });
  });
});

describe('POST /webhook — 流入リンクの案内も同じ送信権の下 (#622)', () => {
  function seedIntroTemplate(): void {
    raw.prepare(
      `INSERT INTO message_templates (id, name, message_type, message_content)
       VALUES ('tpl-1', '紹介あいさつ', 'text', '{"text":"ご紹介ありがとうございます"}')`,
    ).run();
    raw.prepare(`UPDATE entry_routes SET intro_template_id = 'tpl-1' WHERE id = 'route-1'`).run();
  }

  test('並行followの負けた側は流入リンクの案内も押さない', async () => {
    seedIntroTemplate();
    lineClientMocks.replyMessage.mockImplementation(
      async () => { await new Promise((resolve) => setTimeout(resolve, 50)); },
    );
    await Promise.all([postFollow('webhook-a'), postFollow('webhook-b')]);

    // シナリオ1通（reply）＋ 流入リンクの案内1通（push）。負けた側は0通。
    expect(lineClientMocks.replyMessage.mock.calls.length).toBe(1);
    expect(lineClientMocks.pushMessage.mock.calls.length).toBe(1);
  });

  test('送信権を持つ実行がいるときは、単独のfollowでも案内を押さない', async () => {
    seedIntroTemplate();
    raw.prepare(
      `INSERT INTO friend_add_send_claims (line_account_id, friend_id, event_id, generation, claimed_at)
       VALUES ('account-1', 'friend-1', 'webhook-holder', 1, '2999-01-01T00:00:00.000+09:00')`,
    ).run();
    await postFollow('webhook-new');
    expect(sendCount()).toBe(0);
  });

  test('回収された旧持ち主は、案内も台帳の確定もしない', async () => {
    seedIntroTemplate();
    // 送信のあいだに予約を奪われる状況を作る。
    lineClientMocks.replyMessage.mockImplementation(async () => {
      raw.prepare(
        `UPDATE friend_add_send_claims SET event_id = 'webhook-thief', generation = generation + 1`,
      ).run();
    });
    await postFollow('webhook-a');

    // 送ってしまった1通は取り消せないが、そのあとの案内は押さない
    expect(lineClientMocks.pushMessage.mock.calls.length).toBe(0);
    // 台帳は勝った側が確定する。回収された側は書かない。
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ routing_status: 'pending' });
    // 予約は奪った側のまま
    expect(raw.prepare(`SELECT event_id FROM friend_add_send_claims`).get())
      .toEqual({ event_id: 'webhook-thief' });
  });
});
