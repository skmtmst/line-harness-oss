import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// N-082 (Issue #619): 非テキスト受信を自動応答の種別条件へ接続する契約テスト。
// Webhook の非テキスト分岐が matchAndReply へ正しい種別で渡すこと、
// 対象なし・停止中・別アカウント・重複は送信しないこと、
// LINE の通常保存・受信箱・メディア処理を壊さないことを確かめる。
// 外部 LINE への送信は LineClient モックで止める。

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  replyMessageWithRequestId: vi.fn(),
  pushMessage: vi.fn(),
}));

const seenAutoReplyEvents = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getTemplateById: vi.fn(),
  reserveLineWebhookEvent: vi.fn().mockResolvedValue(true),
  markLineWebhookEventSucceeded: vi.fn().mockResolvedValue(undefined),
  markLineWebhookEventFailed: vi.fn().mockResolvedValue(undefined),
  recordFriendAddEvent: vi.fn().mockResolvedValue('friend-add-event-1'),
  captureFriendAddEventAttribution: vi.fn().mockResolvedValue(null),
  markFriendAddEventRouting: vi.fn().mockResolvedValue(undefined),
  recordAnalyticsEvent: vi.fn().mockResolvedValue({ id: 'analytics-event-1' }),
  recordAutoReplyHit: vi.fn().mockResolvedValue(undefined),
  // 二重実行の検証ができるよう、同じ incomingEventId の2回目は不成立にする。
  reserveAutoReplyEvaluation: vi.fn().mockImplementation(async (_db, input) => {
    if (seenAutoReplyEvents.ids.has(input.incomingEventId)) {
      return {
        created: false,
        row: { id: `evaluation-${input.incomingEventId}`, incoming_event_id: input.incomingEventId, status: 'evaluating' },
      };
    }
    seenAutoReplyEvents.ids.add(input.incomingEventId);
    return {
      created: true,
      row: {
        id: `evaluation-${input.incomingEventId}`,
        incoming_event_id: input.incomingEventId,
        status: 'received',
        reply_status: 'not_attempted',
      },
    };
  }),
  ensureAutoReplyPublishedVersion: vi.fn().mockResolvedValue({ id: 'version-1' }),
  recordAutoReplyEvaluationDetail: vi.fn().mockResolvedValue(undefined),
  markAutoReplyEvaluationMatched: vi.fn().mockResolvedValue(undefined),
  markAutoReplyEvaluationSkipped: vi.fn().mockResolvedValue(undefined),
  markAutoReplyEvaluationFinished: vi.fn().mockResolvedValue(undefined),
  reserveAutoReplyActionRun: vi.fn().mockResolvedValue({ id: 'action-run-1', acquired: true }),
  finishAutoReplyActionRun: vi.fn().mockResolvedValue(undefined),
  toJstString: vi.fn().mockReturnValue('2026-08-24T12:00:00.000+09:00'),
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
  logOutgoingMessage: vi.fn().mockResolvedValue('outgoing-log-1'),
}));

vi.mock('../services/friend-add-routing.js', () => ({
  applyFriendAddRouting: vi.fn().mockResolvedValue({ routed: false, suppressed: false, enrollments: [] }),
}));

vi.mock('../services/activity-mileage.js', () => ({
  awardActivityMileage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/carousel-tap.js', () => ({
  handleCarouselTap: vi.fn().mockResolvedValue({ kind: 'ran', executed: 0 }),
}));

vi.mock('../services/interpolation-context.js', () => ({
  resolveInterpolationExtra: vi.fn().mockResolvedValue({}),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn((_type: string, content: string) => ({ type: 'text', text: content })),
  expandVariables: vi.fn((content: string) => content),
  resolveMetadata: vi.fn().mockResolvedValue({}),
  messageToLogPayload: vi.fn((message: unknown) => ({ messageType: 'text', content: JSON.stringify(message) })),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  getFriendByLineUserIdForAccount,
  getLineAccounts,
  jstNow,
  recordAnalyticsEvent,
  upsertChatOnMessage,
  upsertFriend,
} from '@line-crm/db';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

// auto_replies 参照だけを行で返す DB スタブ。WHERE (is_active=1 AND
// (line_account_id IS NULL OR = ?)) と同じ絞り込みをモック側で再現し、
// 停止中・別アカウントの除外が効くことを検証できるようにする。
function makeDb(allRules: Record<string, unknown>[], lineAccountId: string | null) {
  const chainable = (overrides: Record<string, unknown> = {}) => {
    const stmt: Record<string, unknown> = {
      run: vi.fn().mockResolvedValue({}),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
      ...overrides,
    };
    stmt.bind = vi.fn().mockReturnValue(stmt);
    return stmt;
  };
  const db = {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM auto_replies')) {
        const visible = allRules.filter(
          (rule) => rule.is_active === 1 && (rule.line_account_id == null || rule.line_account_id === lineAccountId),
        );
        return chainable({ all: vi.fn().mockResolvedValue({ results: visible }) });
      }
      return chainable();
    }),
  } as unknown as D1Database;
  return db;
}

const baseEnv = {
  DB: makeDb([], 'account-main'),
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const baseExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

const ACCOUNT = {
  id: 'account-main',
  channel_secret: 'env-default-secret',
  channel_access_token: 'account-token',
  is_active: 1,
} as never;

const FRIEND = {
  id: 'friend-1',
  line_user_id: 'U-1',
  line_account_id: 'account-main',
} as never;

function kindRule(kind: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `rule-${kind}`,
    line_account_id: 'account-main',
    keyword: '',
    match_type: 'exact',
    keywords_json: null,
    keyword_match_mode: null,
    respond_to_all: 1,
    message_kinds_json: JSON.stringify([kind]),
    priority: 0,
    is_active: 1,
    template_id: null,
    response_type: 'text',
    response_content: `${kind}を受け付けました`,
    actions_json: null,
    created_at: '2026-01-01T00:00:00.000+09:00',
    ...overrides,
  };
}

function nonTextEvent(message: Record<string, unknown>, webhookEventId: string) {
  return {
    type: 'message',
    message,
    replyToken: `reply-${webhookEventId}`,
    timestamp: 1787530800000,
    source: { type: 'user', userId: 'U-1' },
    webhookEventId,
    deliveryContext: { isRedelivery: false },
    mode: 'active',
  };
}

async function postWebhook(db: D1Database, events: unknown[]) {
  vi.mocked(verifySignature).mockResolvedValue(true);
  vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT]);
  vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValue(FRIEND);
  const executionCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
  const res = await setupApp().request(
    '/webhook',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
      body: JSON.stringify({ events }),
    },
    { ...baseEnv, DB: db },
    executionCtx,
  );
  expect(res.status).toBe(200);
  await (vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<void>);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  seenAutoReplyEvents.ids.clear();
  vi.mocked(jstNow).mockReturnValue('2026-09-08T12:00:00.000+09:00');
  lineClientMocks.replyMessageWithRequestId.mockResolvedValue({ requestId: 'req-1' });
});

describe('POST /webhook — N-082 非テキスト受信の自動応答接続', () => {
  test.each([
    ['image', { id: 'msg-image-1', type: 'image' }],
    ['sticker', { id: 'msg-sticker-1', type: 'sticker', packageId: '1', stickerId: '2' }],
    ['location', { id: 'msg-location-1', type: 'location', title: '渋谷駅', latitude: 35.65, longitude: 139.7 }],
    ['video', { id: 'msg-video-1', type: 'video' }],
    ['audio', { id: 'msg-audio-1', type: 'audio' }],
    ['file', { id: 'msg-file-1', type: 'file', fileName: 'menu.pdf', fileSize: 123 }],
  ])('%s を正しい種別で自動応答評価へ渡し、返信して受信箱を抑止する', async (kind, message) => {
    const db = makeDb([kindRule(kind)], 'account-main');
    await postWebhook(db, [nonTextEvent(message, `evt-${kind}-1`)]);

    // 正しい種別で返信した（外部 LINE への送信はモックで止まる）。
    expect(lineClientMocks.replyMessageWithRequestId).toHaveBeenCalledOnce();
    const [replyToken] = lineClientMocks.replyMessageWithRequestId.mock.calls[0];
    expect(replyToken).toBe(`reply-evt-${kind}-1`);
    // 当たったので受信箱は unread にしない。
    expect(upsertChatOnMessage).not.toHaveBeenCalled();
    // 受信の通常保存は壊さない（messages_log へ incoming を記録）。
    const prepares = vi.mocked(db.prepare).mock.calls.map((call) => String(call[0]));
    expect(prepares.some((sql) => sql.includes('INSERT INTO messages_log'))).toBe(true);
    // 分析イベントに matched=true が載る。
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      eventType: 'message_received',
      dimensions: { messageType: kind, matched: true },
    }));
  });

  test('対象ルールなしは送信せず、受信箱を unread にして保存は残す', async () => {
    const db = makeDb([], 'account-main');
    await postWebhook(db, [nonTextEvent({ id: 'msg-image-9', type: 'image' }, 'evt-norule-1')]);

    expect(lineClientMocks.replyMessageWithRequestId).not.toHaveBeenCalled();
    expect(lineClientMocks.pushMessage).not.toHaveBeenCalled();
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
    const prepares = vi.mocked(db.prepare).mock.calls.map((call) => String(call[0]));
    expect(prepares.some((sql) => sql.includes('INSERT INTO messages_log'))).toBe(true);
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      dimensions: { messageType: 'image', matched: false },
    }));
  });

  test('停止中のルールには返さない', async () => {
    const db = makeDb([kindRule('image', { is_active: 0 })], 'account-main');
    await postWebhook(db, [nonTextEvent({ id: 'msg-image-2', type: 'image' }, 'evt-stopped-1')]);

    expect(lineClientMocks.replyMessageWithRequestId).not.toHaveBeenCalled();
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
  });

  test('別アカウントのルールには返さない', async () => {
    const db = makeDb([kindRule('image', { line_account_id: 'account-other' })], 'account-main');
    await postWebhook(db, [nonTextEvent({ id: 'msg-image-3', type: 'image' }, 'evt-other-account-1')]);

    expect(lineClientMocks.replyMessageWithRequestId).not.toHaveBeenCalled();
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
  });

  test('キーワード条件のルールは非テキストの本文なしでは当たらない（本文を捏造しない）', async () => {
    const db = makeDb([{
      ...kindRule('image', { respond_to_all: 0 }),
      keyword: 'こんにちは',
      match_type: 'contains',
      message_kinds_json: null,
    }], 'account-main');
    await postWebhook(db, [nonTextEvent({ id: 'msg-image-4', type: 'image' }, 'evt-keyword-1')]);

    expect(lineClientMocks.replyMessageWithRequestId).not.toHaveBeenCalled();
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
  });

  test('重複 Webhook は2通目を送信しない', async () => {
    const db = makeDb([kindRule('image')], 'account-main');
    const event = nonTextEvent({ id: 'msg-image-5', type: 'image' }, 'evt-duplicate-1');
    await postWebhook(db, [event]);
    await postWebhook(db, [event]);

    expect(lineClientMocks.replyMessageWithRequestId).toHaveBeenCalledTimes(1);
  });

  test('LINE 返信の失敗でも Webhook は200で受け、落とさない', async () => {
    lineClientMocks.replyMessageWithRequestId.mockRejectedValueOnce(new Error('line unavailable'));
    const db = makeDb([kindRule('video')], 'account-main');
    await postWebhook(db, [nonTextEvent({ id: 'msg-video-2', type: 'video' }, 'evt-failure-1')]);

    expect(lineClientMocks.replyMessageWithRequestId).toHaveBeenCalledOnce();
  });

  test('text の既存動作は壊さない（キーワード一致で返信・不一致で unread）', async () => {
    const db = makeDb([{
      ...kindRule('text', { message_kinds_json: null, respond_to_all: 0 }),
      keyword: 'こんにちは',
      match_type: 'exact',
    }], 'account-main');
    const textEvent = (text: string, webhookEventId: string) => ({
      type: 'message',
      message: { id: `msg-${webhookEventId}`, type: 'text', text },
      replyToken: `reply-${webhookEventId}`,
      timestamp: 1787530800000,
      source: { type: 'user', userId: 'U-1' },
      webhookEventId,
      deliveryContext: { isRedelivery: false },
      mode: 'active',
    });

    await postWebhook(db, [textEvent('こんにちは', 'evt-text-hit-1')]);
    expect(lineClientMocks.replyMessageWithRequestId).toHaveBeenCalledTimes(1);
    expect(upsertChatOnMessage).not.toHaveBeenCalled();

    await postWebhook(db, [textEvent('さようなら', 'evt-text-miss-1')]);
    expect(lineClientMocks.replyMessageWithRequestId).toHaveBeenCalledTimes(1);
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
  });

  test('初回接触の非テキスト送信者も友だち登録して処理する', async () => {
    vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValueOnce(null);
    lineClientMocks.getProfile.mockResolvedValueOnce({ displayName: '初めましてさん' });
    vi.mocked(upsertFriend).mockResolvedValueOnce(FRIEND);
    const db = makeDb([kindRule('sticker')], 'account-main');
    await postWebhook(db, [nonTextEvent(
      { id: 'msg-sticker-9', type: 'sticker', packageId: '1', stickerId: '2' },
      'evt-first-contact-1',
    )]);

    expect(upsertFriend).toHaveBeenCalled();
    expect(lineClientMocks.replyMessageWithRequestId).toHaveBeenCalledOnce();
  });
});
