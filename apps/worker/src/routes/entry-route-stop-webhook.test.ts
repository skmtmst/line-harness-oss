import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// N-244 競合順序: OAuth/LIFFで候補保存→経路停止→follow webhook到着の順でも、
// 停止refを friends.ref_code・計測・友だち追加ルールへ使わない。
// webhook側で候補ref/既存refを使う直前に inactive entry route を判定し、
// 停止済みなら破棄する。active・不存在の既存フローは維持する。

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  replyMessageWithRequestId: vi.fn(),
  pushMessage: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  getScenarios: vi.fn().mockResolvedValue([]),
  enrollFriendInScenario: vi.fn().mockResolvedValue(null),
  getFriendAddScenarioIds: vi.fn().mockResolvedValue([]),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn().mockReturnValue('2026-09-08 00:00:00'),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  getEntryRouteByRefCodeAny: vi.fn().mockResolvedValue(null),
  getMessageTemplateById: vi.fn().mockResolvedValue(null),
  recordFriendAddEvent: vi.fn().mockResolvedValue('friend-add-event-1'),
  captureFriendAddEventAttribution: vi.fn().mockResolvedValue(null),
  markFriendAddEventRouting: vi.fn().mockResolvedValue(undefined),
  recordAnalyticsEvent: vi.fn().mockResolvedValue({ id: 'analytics-event-1' }),
  toJstString: vi.fn().mockReturnValue('2026-09-08T00:00:00.000+09:00'),
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

vi.mock('../services/friend-add-routing.js', () => ({
  applyFriendAddRouting: vi.fn().mockResolvedValue({ routed: false, suppressed: false, enrollments: [] }),
}));

vi.mock('../services/activity-mileage.js', () => ({
  awardActivityMileage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  expandVariables: vi.fn(),
  resolveMetadata: vi.fn(),
  messageToLogPayload: vi.fn(),
  pushImmediateFirstStep: vi.fn().mockResolvedValue(false),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  upsertFriend,
  getFriendById,
  getEntryRouteByRefCode,
  getEntryRouteByRefCodeAny,
  captureFriendAddEventAttribution,
  getLineAccounts,
} from '@line-crm/db';
import { applyFriendAddRouting } from '../services/friend-add-routing.js';
import {
  enrollFriendInScenario,
  getScenarios,
  getFriendAddScenarioIds,
  getMessageTemplateById,
  markFriendAddEventRouting,
} from '@line-crm/db';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

const preparedSql: string[] = [];
const stubDb = {
  prepare: (sql: string) => {
    preparedSql.push(sql);
    return {
      bind: (..._args: unknown[]) => ({
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    };
  },
} as unknown as D1Database;

const baseEnv = {
  DB: stubDb,
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const baseExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

const STOPPED = {
  id: 'route-stopped',
  ref_code: 'stopped1',
  is_active: 0,
  run_account_friend_add_scenarios: 1,
  intro_template_id: null,
  scenario_id: null,
};

const ACTIVE = {
  id: 'route-active',
  ref_code: 'live1',
  is_active: 1,
  run_account_friend_add_scenarios: 1,
  intro_template_id: null,
  scenario_id: null,
};

async function sendFollow(userId: string, webhookEventId: string) {
  const waitUntil = vi.fn();
  const response = await setupApp().request('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
    body: JSON.stringify({
      events: [{
        type: 'follow', webhookEventId, timestamp: 1787530800000,
        source: { type: 'user', userId }, replyToken: 'reply-1',
      }],
    }),
  }, baseEnv, { ...baseExecutionCtx, waitUntil } as ExecutionContext);
  expect(response.status).toBe(200);
  await (waitUntil.mock.calls[0]?.[0] as Promise<void>);
}

beforeEach(() => {
  vi.clearAllMocks();
  preparedSql.length = 0;
  lineClientMocks.pushMessage.mockResolvedValue(undefined);
  lineClientMocks.getProfile.mockResolvedValue({ displayName: 'Tester' });
  vi.mocked(verifySignature).mockResolvedValue(true);
  vi.mocked(getLineAccounts).mockResolvedValue([{
    id: 'account-main', channel_secret: 'env-default-secret',
    channel_access_token: 'account-token', is_active: 1,
  } as never]);
  vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
  vi.mocked(getEntryRouteByRefCodeAny).mockResolvedValue(null);
  vi.mocked(captureFriendAddEventAttribution).mockResolvedValue(null);
  vi.mocked(applyFriendAddRouting).mockResolvedValue({ routed: false, suppressed: false, enrollments: [] } as never);
});

describe('停止refの競合順序: 候補保存→停止→follow (N-244)', () => {
  test('停止後に届いたfollowは候補・既存refを使わず帰属・計測・ルールへ落とさない', async () => {
    // 停止前に保存された候補と friends.ref_code が残っている状態。
    vi.mocked(captureFriendAddEventAttribution).mockResolvedValue({
      refCode: 'stopped1', entryRouteId: 'route-stopped',
    });
    vi.mocked(getEntryRouteByRefCodeAny).mockResolvedValue(STOPPED as never);
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
      ref_code: 'stopped1', unfollow_count: 0,
      created_at: '2026-09-08T00:00:00.000+09:00',
      first_followed_at: '2026-09-08T00:00:00.000+09:00',
    } as never);
    vi.mocked(getFriendById).mockResolvedValue({
      id: 'friend-1', ref_code: 'stopped1',
    } as never);

    await sendFollow('U-1', 'webhook-follow-stopped');

    // 友だち追加ルール (unknown-route fallback を含む) へは一切流さない。
    // N-244差戻: 停止ref由来ではタグ・シナリオを一切開始しない。
    expect(applyFriendAddRouting).not.toHaveBeenCalled();
    // 停止refで紹介経路を引かない。
    expect(getEntryRouteByRefCode).not.toHaveBeenCalledWith(
      baseEnv.DB, 'stopped1',
    );
    // 取り込んだ計測(帰属)を unavailable へ戻す。
    expect(preparedSql.some(
      (sql) => sql.includes('friend_add_events') && sql.includes('unavailable'),
    )).toBe(true);
    // friends.ref_code の停止値を消す。
    expect(preparedSql.some((sql) => sql.includes('SET ref_code = NULL'))).toBe(true);
    // 紹介の副作用( enroll / 紹介push )を出さない。
    expect(enrollFriendInScenario).not.toHaveBeenCalled();
    expect(lineClientMocks.pushMessage).not.toHaveBeenCalled();
  });

  test('active経路の候補はそのまま帰属・ルールへ使う', async () => {
    vi.mocked(captureFriendAddEventAttribution).mockResolvedValue({
      refCode: 'live1', entryRouteId: 'route-active',
    });
    vi.mocked(getEntryRouteByRefCodeAny).mockResolvedValue(ACTIVE as never);
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(ACTIVE as never);
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
      ref_code: 'live1', unfollow_count: 0,
      created_at: '2026-09-08T00:00:00.000+09:00',
      first_followed_at: '2026-09-08T00:00:00.000+09:00',
    } as never);

    await sendFollow('U-1', 'webhook-follow-active');

    expect(applyFriendAddRouting).toHaveBeenCalledWith(
      baseEnv.DB, 'account-main', expect.anything(), expect.anything(),
      // N-101(#622) で送信権の関門などが同じ引数へ加わった。ここで見たいのは
      // 「停止していない経路のIDがそのまま渡ること」なので、経路IDだけを見る。
      expect.objectContaining({ entryRouteId: 'route-active' }),
    );
    expect(preparedSql.some(
      (sql) => sql.includes('friend_add_events') && sql.includes('unavailable'),
    )).toBe(false);
    expect(preparedSql.some((sql) => sql.includes('SET ref_code = NULL'))).toBe(false);
  });

  test('停止ref由来では非空のアカウント共通シナリオも開始しない', async () => {
    // 実行可能な fallback (unknown-route ルール) と非空の友だち追加
    // シナリオがあっても、停止ref由来では何も始まらない (N-244差戻)。
    vi.mocked(captureFriendAddEventAttribution).mockResolvedValue({
      refCode: 'stopped1', entryRouteId: 'route-stopped',
    });
    vi.mocked(getEntryRouteByRefCodeAny).mockResolvedValue(STOPPED as never);
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
      ref_code: 'stopped1', unfollow_count: 0,
      created_at: '2026-09-08T00:00:00.000+09:00',
      first_followed_at: '2026-09-08T00:00:00.000+09:00',
    } as never);
    vi.mocked(getFriendById).mockResolvedValue({
      id: 'friend-1', ref_code: 'stopped1',
    } as never);
    vi.mocked(getScenarios).mockResolvedValue([
      { id: 'sc-account', line_account_id: null },
    ] as never);
    vi.mocked(getFriendAddScenarioIds).mockResolvedValue(['sc-account']);

    await sendFollow('U-1', 'webhook-follow-stopped-scenarios');

    expect(applyFriendAddRouting).not.toHaveBeenCalled();
    expect(enrollFriendInScenario).not.toHaveBeenCalled();
    expect(lineClientMocks.pushMessage).not.toHaveBeenCalled();
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    expect(markFriendAddEventRouting).toHaveBeenCalledWith(
      baseEnv.DB,
      expect.objectContaining({ status: 'suppressed' }),
    );
  });

  test('停止候補B由来では過去active経路Aへfallbackしない', async () => {
    // B停止由来の follow で、friends.ref_code の過去active経路Aの
    // 紹介メッセージ/専用scenarioが動かないこと (N-244差戻・再審査)。
    // Aは実行可能 (紹介文・専用scenario付き) にして抑止を直接見る。
    const STOPPED_B = {
      id: 'route-stopped', ref_code: 'stoppedB', is_active: 0,
      run_account_friend_add_scenarios: 1, intro_template_id: null, scenario_id: null,
    };
    const ACTIVE_A = {
      id: 'route-active', ref_code: 'liveA', is_active: 1,
      run_account_friend_add_scenarios: 1, intro_template_id: 'tmpl-1', scenario_id: 'sc-intro',
    };
    vi.mocked(captureFriendAddEventAttribution).mockResolvedValue({
      refCode: 'stoppedB', entryRouteId: 'route-stopped',
    });
    vi.mocked(getEntryRouteByRefCodeAny).mockImplementation(
      async (_db: D1Database, ref: string) =>
        (ref === 'stoppedB' ? STOPPED_B : ref === 'liveA' ? ACTIVE_A : null) as never,
    );
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
      ref_code: 'liveA', unfollow_count: 0,
      created_at: '2026-09-08T00:00:00.000+09:00',
      first_followed_at: '2026-09-08T00:00:00.000+09:00',
    } as never);
    vi.mocked(getFriendById).mockResolvedValue({
      id: 'friend-1', ref_code: 'liveA',
    } as never);
    vi.mocked(getEntryRouteByRefCode).mockImplementation(
      async (_db: D1Database, ref: string) => (ref === 'liveA' ? ACTIVE_A : null) as never,
    );
    vi.mocked(getMessageTemplateById).mockResolvedValue({
      message_type: 'text', message_content: 'hi',
    } as never);
    vi.mocked(enrollFriendInScenario).mockResolvedValue({ id: 'E-1' } as never);
    vi.mocked(getScenarios).mockResolvedValue([
      { id: 'sc-account', line_account_id: null },
    ] as never);
    vi.mocked(getFriendAddScenarioIds).mockResolvedValue(['sc-account']);

    await sendFollow('U-1', 'webhook-follow-stopped-fallback');

    // Aへfallbackしない: 紹介経路を引かず、pushもenrollも0件。
    expect(getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(applyFriendAddRouting).not.toHaveBeenCalled();
    expect(enrollFriendInScenario).not.toHaveBeenCalled();
    expect(lineClientMocks.pushMessage).not.toHaveBeenCalled();
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    // Aの履歴は残す: friends.ref_code を消さない。
    expect(preparedSql.some((sql) => sql.includes('SET ref_code = NULL'))).toBe(false);
    // Bの計測は unavailable へ戻す。
    expect(preparedSql.some(
      (sql) => sql.includes('friend_add_events') && sql.includes('unavailable'),
    )).toBe(true);
    expect(markFriendAddEventRouting).toHaveBeenCalledWith(
      baseEnv.DB,
      expect.objectContaining({ status: 'suppressed' }),
    );
  });

  test('不存在refのfollowは従来どおり帰属なしで進める', async () => {
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
      ref_code: null, unfollow_count: 0,
      created_at: '2026-09-08T00:00:00.000+09:00',
      first_followed_at: '2026-09-08T00:00:00.000+09:00',
    } as never);
    vi.mocked(getFriendById).mockResolvedValue({
      id: 'friend-1', ref_code: null,
    } as never);

    await sendFollow('U-1', 'webhook-follow-unknown');

    expect(applyFriendAddRouting).toHaveBeenCalledWith(
      baseEnv.DB, 'account-main', expect.anything(), expect.anything(),
      expect.objectContaining({ entryRouteId: null }),
    );
    expect(preparedSql.some((sql) => sql.includes('SET ref_code = NULL'))).toBe(false);
  });
});
