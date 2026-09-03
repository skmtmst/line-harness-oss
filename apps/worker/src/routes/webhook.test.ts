import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  replyMessageWithRequestId: vi.fn(),
  pushMessage: vi.fn(),
}));

// Stub the DB graph — these tests focus on webhook guard behavior and the
// first-contact friend registration path without touching real D1/LINE.
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
  reserveAutoReplyEvaluation: vi.fn().mockImplementation(async (_db, input) => ({
    created: true,
    row: {
      id: `evaluation-${input.incomingEventId}`,
      incoming_event_id: input.incomingEventId,
      status: 'received',
      reply_status: 'not_attempted',
    },
  })),
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
  logOutgoingMessage: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  expandVariables: vi.fn(),
  resolveMetadata: vi.fn(),
  messageToLogPayload: vi.fn(),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  addTagToFriend,
  advanceFriendScenario,
  completeFriendScenario,
  computeNextDeliveryAt,
  enrollFriendInScenario,
  getEntryRouteByRefCode,
  getFriendByLineUserIdForAccount,
  getLineAccounts,
  getMessageTemplateById,
  getScenarioSteps,
  getScenarios,
  jstNow,
  reserveLineWebhookEvent,
  resolveStepContent,
  updateFriendFollowStatus,
  upsertChatOnMessage,
  upsertFriend,
  recordFriendAddEvent,
  captureFriendAddEventAttribution,
  markFriendAddEventRouting,
  recordAnalyticsEvent,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { handleCarouselTap } from '../services/carousel-tap.js';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

const stubDb = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
    })),
  })),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLineAccounts).mockResolvedValue([]);
});

describe('POST /webhook — V6 friend-add ledger', () => {
  test('再追加と今回リンクをWebhookイベント単位で記録する', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([{
      id: 'account-main', channel_secret: 'env-default-secret',
      channel_access_token: 'account-token', is_active: 1,
    } as never]);
    lineClientMocks.getProfile.mockResolvedValue({ displayName: '田中さん' });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
      unfollow_count: 1, created_at: '2026-01-01T00:00:00.000+09:00',
      first_followed_at: '2026-01-01T00:00:00.000+09:00',
    } as never);
    vi.mocked(captureFriendAddEventAttribution).mockResolvedValue({
      refCode: 'summer', entryRouteId: 'route-1',
    });
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
    vi.mocked(getScenarios).mockResolvedValue([]);

    const waitUntil = vi.fn();
    const response = await setupApp().request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
      body: JSON.stringify({ events: [{
        type: 'follow', webhookEventId: 'webhook-follow-1', timestamp: 1787530800000,
        source: { type: 'user', userId: 'U-1' }, replyToken: 'reply-1',
        follow: { isUnblocked: true },
      }] }),
    }, baseEnv, { ...baseExecutionCtx, waitUntil } as ExecutionContext);
    expect(response.status).toBe(200);
    const processing = waitUntil.mock.calls[0]?.[0] as Promise<void>;
    await processing;

    expect(recordFriendAddEvent).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({
      lineAccountId: 'account-main', friendId: 'friend-1', webhookEventId: 'webhook-follow-1',
      friendKind: 'returning', isUnblockedHint: true,
    }));
    expect(captureFriendAddEventAttribution).toHaveBeenCalledWith(baseEnv.DB, {
      eventId: 'friend-add-event-1', lineAccountId: 'account-main', friendId: 'friend-1',
    });
    expect(markFriendAddEventRouting).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({
      eventId: 'friend-add-event-1', lineAccountId: 'account-main', status: 'completed',
    }));
  });
});

describe('POST /webhook — V6分析イベント', () => {
  test('友だち解除をWebhookの発生時刻とIDで記録する', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([{
      id: 'account-main', channel_secret: 'env-default-secret',
      channel_access_token: 'account-token', is_active: 1,
    } as never]);
    vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-1', line_account_id: 'account-main',
    } as never);
    const waitUntil = vi.fn();

    const response = await setupApp().request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
      body: JSON.stringify({ events: [{
        type: 'unfollow', webhookEventId: 'webhook-unfollow-1', timestamp: 1787530800000,
        source: { type: 'user', userId: 'U-1' },
      }] }),
    }, baseEnv, { ...baseExecutionCtx, waitUntil } as ExecutionContext);
    expect(response.status).toBe(200);
    await (waitUntil.mock.calls[0]?.[0] as Promise<void>);

    expect(updateFriendFollowStatus).toHaveBeenCalledWith(
      baseEnv.DB, 'U-1', false, 'account-main',
    );
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(baseEnv.DB, {
      lineAccountId: 'account-main',
      friendId: 'friend-1',
      eventType: 'friend_unfollow',
      sourceKind: 'line_webhook',
      sourceId: 'webhook-unfollow-1',
      occurredAt: new Date(1787530800000).toISOString(),
      dimensions: undefined,
    });
  });
});

describe('POST /webhook — DoS defenses (#104)', () => {
  test('rejects with 413 when Content-Length declares an oversized body', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024), // 2 MiB > 1 MiB cap
          'X-Line-Signature': 'whatever',
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    // Signature verification must not even be attempted on an oversized body.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('rejects with 413 when actual body exceeds the cap even if Content-Length is absent', async () => {
    const app = setupApp();
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'whatever',
        },
        body: oversizedBody,
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('verifies signature before parsing JSON — malformed body with invalid signature never reaches the parser', async () => {
    vi.mocked(verifySignature).mockResolvedValue(false);

    const app = setupApp();
    // 44-char signature (valid HMAC-SHA256 base64 length) so it clears the
    // length pre-check and reaches verifySignature. Malformed JSON body: if
    // signature were verified *after* parse (old behavior), we'd hit the
    // parser-failure branch first. With signature-first, we get the invalid-
    // signature branch and never attempt to parse.
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: '{not valid json',
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // verifySignature must run; rejection happens before any parse attempt.
    expect(verifySignature).toHaveBeenCalled();
    expect(verifySignature).toHaveBeenCalledWith('env-default-secret', '{not valid json', validShapedSignature);
  });

  test('rejects unsigned or malformed-signature requests without hitting verifySignature or D1', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Line-Signature header entirely.
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // Fast-rejected before any crypto / DB work.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('台帳の初回記録が失敗しても再試行し、LINEへの応答は200のまま', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(reserveLineWebhookEvent).mockRejectedValueOnce(new Error('raw database details'));
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await setupApp().request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'A'.repeat(43) + '=',
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [{
            type: 'unfollow',
            timestamp: 0,
            source: { type: 'user', userId: 'U-sensitive' },
            webhookEventId: 'evt-ledger-failure',
            deliveryContext: { isRedelivery: false },
            mode: 'active',
          }],
        }),
      },
      baseEnv,
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await expect(processing).resolves.toBeUndefined();
    expect(reserveLineWebhookEvent).toHaveBeenCalledTimes(2);
    expect(updateFriendFollowStatus).toHaveBeenCalledOnce();
    const output = JSON.stringify(errorSpy.mock.calls);
    expect(output).not.toContain('raw database details');
    expect(output).not.toContain('U-sensitive');
    errorSpy.mockRestore();
  });
});

describe('POST /webhook — postback events', () => {
  test('records a carousel tap without firing catch-all automations', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([{
      id: 'account-main', channel_secret: 'env-default-secret',
      channel_access_token: 'account-token', is_active: 1,
    } as never]);
    vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValue({
      id: 'friend-1', line_user_id: 'U-existing', line_account_id: 'account-main',
    } as never);
    const waitUntil = vi.fn();
    const timestamp = 1787530800000;

    const response = await setupApp().request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'x'.repeat(44) },
      body: JSON.stringify({ events: [{
        type: 'postback',
        replyToken: 'reply-token-carousel',
        postback: { data: 'ctpl=template-1&c=0&a=1' },
        timestamp,
        source: { type: 'user', userId: 'U-existing' },
        webhookEventId: 'event-carousel-1',
        deliveryContext: { isRedelivery: false },
        mode: 'active',
      }] }),
    }, baseEnv, { ...baseExecutionCtx, waitUntil } as ExecutionContext);

    expect(response.status).toBe(200);
    await (waitUntil.mock.calls[0]?.[0] as Promise<void>);
    expect(handleCarouselTap).toHaveBeenCalledOnce();
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(baseEnv.DB, {
      lineAccountId: 'account-main',
      friendId: 'friend-1',
      eventType: 'postback_received',
      sourceKind: 'line_webhook',
      sourceId: 'event-carousel-1',
      occurredAt: new Date(timestamp).toISOString(),
      dimensions: { matched: true },
    });
    expect(fireEvent).not.toHaveBeenCalled();
  });

  test('fires postback_received with postback.data so IF-THEN automations run on rich menu taps', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-07-19T12:00:00.000+09:00');
    vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-19T12:00:00.000+09:00',
      updated_at: '2026-07-19T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }), // no auto_reply match
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'postback',
              replyToken: 'reply-token-postback',
              postback: { data: 'tag:premium' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-postback-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    // No auto-reply matched — the reply token must be handed to the event bus
    // so automations can still use it for free reply delivery.
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'postback_received',
      {
        sourceEventId: 'event-postback-1',
        sourceKind: 'line_webhook',
        occurredAt: expect.any(String),
        friendId: 'friend-1',
        eventData: { text: 'tag:premium', matched: false },
        replyToken: 'reply-token-postback',
      },
      'env-default-token',
      null,
    );
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
  });

  test('silent auto-reply rule suppresses the reply but still fires postback_received as matched', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-07-19T12:00:00.000+09:00');
    vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-19T12:00:00.000+09:00',
      updated_at: '2026-07-19T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({
        results: [
          {
            id: 'rule-1',
            keyword: 'tag:premium',
            match_type: 'exact',
            response_type: 'silent',
            response_content: '',
            template_id: null,
          },
        ],
      }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'postback',
              replyToken: 'reply-token-postback',
              postback: { data: 'tag:premium' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-postback-2',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    // Silent rule: no reply sent, but matched=true and the unconsumed reply
    // token still reaches the event bus (rich menu tap → silent + add_tag flow).
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'postback_received',
      {
        sourceEventId: 'event-postback-2',
        sourceKind: 'line_webhook',
        occurredAt: expect.any(String),
        friendId: 'friend-1',
        eventData: { text: 'tag:premium', matched: true },
        replyToken: 'reply-token-postback',
      },
      'env-default-token',
      null,
    );
  });
});

describe('POST /webhook — first-contact existing friends', () => {
  test('auto-registers an unknown text-message sender without firing friend_add handling', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([{
      id: 'account-main',
      is_active: 1,
      channel_secret: 'env-default-secret',
      channel_access_token: 'env-default-token',
    }] as never);
    vi.mocked(getFriendByLineUserIdForAccount).mockResolvedValue(null);
    vi.mocked(jstNow).mockReturnValue('2026-06-18T12:00:00.000+09:00');
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: 'https://example.com/profile.jpg',
      status_message: 'hello',
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });
    vi.mocked(upsertChatOnMessage).mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'unread',
      notes: null,
      last_message_at: '2026-06-18T12:00:00.000+09:00',
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              message: { type: 'text', id: 'message-1', text: 'こんにちは' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    expect(getFriendByLineUserIdForAccount).toHaveBeenCalledWith(
      db,
      'U-existing',
      'account-main',
    );
    expect(lineClientMocks.getProfile).toHaveBeenCalledWith('U-existing');
    expect(upsertFriend).toHaveBeenCalledWith(db, {
      lineUserId: 'U-existing',
      lineAccountId: 'account-main',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'message_received',
      expect.objectContaining({ friendId: 'friend-1' }),
      'env-default-token',
      'account-main',
    );
    expect(getScenarios).not.toHaveBeenCalled();
    expect(enrollFriendInScenario).not.toHaveBeenCalled();

    // Keep the unrelated DB stubs quiet but type-checked as mocked imports.
    expect(updateFriendFollowStatus).not.toHaveBeenCalled();
    expect(getScenarioSteps).not.toHaveBeenCalled();
    expect(advanceFriendScenario).not.toHaveBeenCalled();
    expect(completeFriendScenario).not.toHaveBeenCalled();
    expect(computeNextDeliveryAt).not.toHaveBeenCalled();
    expect(resolveStepContent).not.toHaveBeenCalled();
    expect(addTagToFriend).not.toHaveBeenCalled();
    expect(getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(getMessageTemplateById).not.toHaveBeenCalled();
  });
});
