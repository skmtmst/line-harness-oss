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

async function postFollow(webhookEventId: string): Promise<void> {
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
  }, env(), { waitUntil, passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext);
  expect(response.status).toBe(200);
  await waitUntil.mock.calls[0]?.[0];
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

describe('POST /webhook — 送信失敗は再送可能 (#622)', () => {
  test('送れなかった実行は partial_failed で残し、次の追加を止めない', async () => {
    lineClientMocks.replyMessage.mockRejectedValueOnce(new Error('LINE down'));
    lineClientMocks.pushMessage.mockRejectedValue(new Error('LINE down'));
    await postFollow('webhook-fail');

    const sends = lineClientMocks.replyMessage.mock.calls.length
      + lineClientMocks.pushMessage.mock.calls.length;
    expect(sends).toBeGreaterThan(0);
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      routing_status: 'partial_failed', delivery_count: 0, error_code: 'send_failed',
    });

    // 再送制限は送れなかった実行を数えない。次の追加では選び直す。
    await expect(isFriendAddResendSuppressed(db, {
      lineAccountId: 'account-1', friendId: 'friend-1',
      resendSuppressionHours: 24, now: new Date(),
    })).resolves.toBe(false);
  });
});
