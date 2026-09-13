import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from './event-bus.js';

const actionScoreMocks = vi.hoisted(() => ({
  applyActionScoreEvent: vi.fn(),
}));

interface CapturedInsert {
  sql: string;
  binds: unknown[];
}

function fakeDb(opts: {
  friend?: { line_user_id?: string; line_account_id?: string | null };
  capturedInserts: CapturedInsert[];
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          if (sql.includes('INSERT INTO messages_log')) {
            opts.capturedInserts.push({ sql, binds: args });
          }
          return this;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM friends WHERE id')) {
            return (opts.friend ?? null) as T | null;
          }
          return null;
        },
        async run(): Promise<{ success: true }> {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@line-crm/db');
  return {
    ...actual,
    getActiveOutgoingWebhooksByEvent: vi.fn().mockResolvedValue([]),
    applyScoring: vi.fn().mockResolvedValue(undefined),
    getActiveAutomationsByEvent: vi.fn(),
    createAutomationLog: vi.fn().mockResolvedValue(undefined),
    getActiveNotificationRulesByEvent: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue(undefined),
    addTagToFriend: vi.fn().mockResolvedValue(undefined),
    removeTagFromFriend: vi.fn().mockResolvedValue(undefined),
    enrollFriendInScenario: vi.fn().mockResolvedValue(undefined),
    jstNow: () => '2026-05-08T00:00:00.000+09:00',
    getFriendScore: vi.fn().mockResolvedValue(0),
    getTemplateById: vi.fn().mockResolvedValue(null),
    recordAnalyticsEvent: vi.fn().mockResolvedValue({ id: 'analytics-event-1' }),
    createWebhookInteraction: vi.fn().mockResolvedValue({ id: 'webhook-run-1' }),
    finishWebhookInteraction: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@line-crm/line-sdk', () => {
  return {
    LineClient: vi.fn().mockImplementation(() => ({
      replyMessage: vi.fn().mockResolvedValue(undefined),
      pushMessage: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('./ad-conversion.js', () => ({
  sendAdConversions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./outgoing-webhook-delivery.js', async () => {
  // 共通の安全送信だけは本物を使い、旧式 send_webhook 経路の検査を直接確かめる。
  const actual = await vi.importActual<typeof import('./outgoing-webhook-delivery.js')>(
    './outgoing-webhook-delivery.js',
  );
  return {
    ...actual,
    deliverWebhook: vi.fn().mockResolvedValue({ ok: true, attempts: 1, lastStatus: 200 }),
    recordDeliveryOutcome: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('./automation-triggers.js', () => ({
  dispatchAutomationEventWithLogging: vi.fn().mockResolvedValue([]),
}));

vi.mock('./action-score-events.js', () => actionScoreMocks);

describe('fireEvent — send_message action logging', () => {
  let captured: CapturedInsert[];

  beforeEach(async () => {
    captured = [];
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-1',
        line_account_id: 'acc-1',
        conditions: JSON.stringify({ keyword: 'コスト比較' }),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: {
              messageType: 'flex',
              content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"hi"}]}}',
              altText: 'hi',
            },
          },
        ]),
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs flex outgoing message to messages_log when send_message fires via reply', async () => {
    const db = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      db,
      'message_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'コスト比較', matched: true },
        replyToken: 'reply-token-xyz',
      },
      'channel-token',
      'acc-1',
    );

    expect(captured).toHaveLength(1);
    const insert = captured[0];
    expect(insert.sql).toContain('INSERT INTO messages_log');
    // bind order: id, friendId, messageType, content, deliveryType, source, lineAccountId, createdAt
    expect(insert.binds[1]).toBe('friend-1');
    expect(insert.binds[2]).toBe('flex');
    expect(insert.binds[4]).toBe('reply');
    expect(insert.binds[5]).toBe('automation');
    expect(insert.binds[6]).toBe('acc-1');
  });

  it('logs delivery_type=push when no replyToken provided', async () => {
    const db = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      db,
      'message_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'コスト比較', matched: true },
      },
      'channel-token',
      'acc-1',
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].binds[4]).toBe('push');
  });

  it('logs even when text message (not flex) is sent', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-2',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: { messageType: 'text', content: 'hello' },
          },
        ]),
      },
    ]);

    const dbFake = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      dbFake,
      'tag_added',
      { friendId: 'friend-1', eventData: {} },
      'channel-token',
      null,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].binds[2]).toBe('text');
    expect(captured[0].binds[3]).toBe('hello');
    expect(captured[0].binds[6]).toBe(null);
  });

  it('resolves params.template_id via templates table when set', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-tpl',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: {
              template_id: 'tpl-1',
              // content / messageType を空にして template 経由 resolve を強制
            },
          },
        ]),
      },
    ]);
    (db.getTemplateById as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'tpl-1',
      name: 'test-tpl',
      category: 'general',
      message_type: 'flex',
      message_content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"from-template"}]}}',
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const dbFake = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      dbFake,
      'manual_test',
      { friendId: 'friend-1', eventData: {} },
      'channel-token',
      null,
    );

    expect(captured).toHaveLength(1);
    // log には template から取得した messageType / content が記録される
    expect(captured[0].binds[2]).toBe('flex');
    expect(String(captured[0].binds[3])).toContain('from-template');
  });
});

describe('fireEvent — V6分析イベント', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionScoreMocks.applyActionScoreEvent.mockResolvedValue({
      configured: false,
      status: 'legacy',
      applications: [],
    });
  });

  it('発生元ID・時刻・アカウントがそろったイベントだけを追記基盤へ渡す', async () => {
    const dbModule = await import('@line-crm/db');
    (dbModule.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
    const db = fakeDb({ capturedInserts: [] });

    await fireEvent(db, 'message_received', {
      sourceEventId: 'webhook-1',
      sourceKind: 'line_webhook',
      occurredAt: '2026-08-26T00:00:00.000Z',
      friendId: 'friend-1',
      eventData: { text: '保存してはいけない本文', messageType: 'text', matched: true },
    }, undefined, 'account-a');

    expect(dbModule.recordAnalyticsEvent).toHaveBeenCalledWith(db, {
      lineAccountId: 'account-a',
      friendId: 'friend-1',
      eventType: 'message_received',
      sourceKind: 'line_webhook',
      sourceId: 'webhook-1',
      occurredAt: '2026-08-26T00:00:00.000Z',
      dimensions: {
        text: '保存してはいけない本文',
        messageType: 'text',
        matched: true,
        currentScore: 0,
      },
      numericValue: undefined,
    });
  });

  it('発生元時刻がない旧イベントは推測して記録しない', async () => {
    const dbModule = await import('@line-crm/db');
    (dbModule.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
    const db = fakeDb({ capturedInserts: [] });

    await fireEvent(db, 'tag_change', {
      sourceEventId: 'legacy-1', friendId: 'friend-1', eventData: { tagId: 'tag-1' },
    }, undefined, 'account-a');

    expect(dbModule.recordAnalyticsEvent).not.toHaveBeenCalled();
  });
});

describe('fireEvent — V6行動スコア', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const dbModule = await import('@line-crm/db');
    (dbModule.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
  });

  it('元イベントを識別できれば公開版を使い、旧ルールへ二重加点しない', async () => {
    const dbModule = await import('@line-crm/db');
    actionScoreMocks.applyActionScoreEvent.mockResolvedValue({
      configured: true,
      status: 'published',
      applications: [],
    });
    const db = fakeDb({ capturedInserts: [] });

    await fireEvent(db, 'message_received', {
      sourceEventId: 'webhook-1',
      sourceKind: 'line_webhook',
      occurredAt: '2026-08-28T00:00:00.000Z',
      friendId: 'friend-1',
      eventData: {},
    }, undefined, 'account-1');

    expect(actionScoreMocks.applyActionScoreEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      eventType: 'message_received',
      source: 'line_webhook',
      sourceEventId: 'webhook-1',
    }));
    expect(dbModule.applyScoring).not.toHaveBeenCalled();
  });

  it('元イベントを識別できない旧経路は、移行前のルールを維持する', async () => {
    const dbModule = await import('@line-crm/db');
    const db = fakeDb({ capturedInserts: [] });
    await fireEvent(db, 'message_received', { friendId: 'friend-1', eventData: {} });
    expect(actionScoreMocks.applyActionScoreEvent).not.toHaveBeenCalled();
    expect(dbModule.applyScoring).toHaveBeenCalledWith(db, 'friend-1', 'message_received');
  });
});

describe('fireEvent — 送信Webhookのアカウント解決', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const dbModule = await import('@line-crm/db');
    (dbModule.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
    (dbModule.getActiveOutgoingWebhooksByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
  });

  it('明示されたアカウントをそのまま送信Webhookの絞り込みへ渡す', async () => {
    const dbModule = await import('@line-crm/db');
    const db = fakeDb({ capturedInserts: [] });

    await fireEvent(db, 'message_received', { friendId: 'friend-1' }, undefined, 'account-a');

    expect(dbModule.getActiveOutgoingWebhooksByEvent)
      .toHaveBeenCalledWith(db, 'message_received', 'account-a');
  });

  it('送信結果をアカウント別の記録へ残し、配送IDを送る', async () => {
    const dbModule = await import('@line-crm/db');
    const deliveryModule = await import('./outgoing-webhook-delivery.js');
    const db = fakeDb({ capturedInserts: [] });
    (dbModule.getActiveOutgoingWebhooksByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([{
        id: 'webhook-a', name: '顧客管理', url: 'https://example.com/hook',
        secret: null, event_types: '["friend.added"]', max_retries: 0,
      }]);

    await fireEvent(db, 'friend.added', {
      sourceEventId: 'friend-event-1', sourceKind: 'line_webhook',
    }, undefined, 'account-a');

    expect(dbModule.createWebhookInteraction).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a', webhookId: 'webhook-a', direction: 'outgoing',
      idempotencyKey: 'outgoing_webhook:webhook-a:line_webhook:friend-event-1',
    }));
    expect(deliveryModule.deliverWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'webhook-a' }),
      expect.any(String),
      { idempotencyKey: 'outgoing_webhook:webhook-a:line_webhook:friend-event-1' },
    );
    expect(dbModule.finishWebhookInteraction).toHaveBeenCalledWith(
      db, 'webhook-run-1', 'account-a', expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('アカウント未指定時はfriendIdから一度だけ解決する', async () => {
    const dbModule = await import('@line-crm/db');
    const db = fakeDb({
      friend: { line_account_id: 'account-from-friend' },
      capturedInserts: [],
    });

    await fireEvent(db, 'tag_change', { friendId: 'friend-1' });

    expect(dbModule.getActiveOutgoingWebhooksByEvent)
      .toHaveBeenCalledWith(db, 'tag_change', 'account-from-friend');
  });

  it('アカウントもfriendIdも無いイベントはNULL所属だけを検索できる値を渡す', async () => {
    const dbModule = await import('@line-crm/db');
    const deliveryModule = await import('./outgoing-webhook-delivery.js');
    const db = fakeDb({ capturedInserts: [] });
    (dbModule.getActiveOutgoingWebhooksByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([{
        id: 'legacy-webhook',
        event_types: '["*"]',
        max_retries: 0,
      }]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await fireEvent(db, 'incoming_webhook.custom', { eventData: { webhookId: 'webhook-1' } });

    expect(dbModule.getActiveOutgoingWebhooksByEvent)
      .toHaveBeenCalledWith(db, 'incoming_webhook.custom', undefined);
    expect(deliveryModule.recordDeliveryOutcome).toHaveBeenCalledWith(db, 'legacy-webhook', true);
    expect(log).toHaveBeenCalledOnce();
    const record = log.mock.calls[0]?.[0] as string;
    expect(JSON.parse(record)).toEqual({
      event: 'outgoing_webhook_line_account_unknown',
      eventType: 'incoming_webhook.custom',
      hasFriendId: false,
    });
    expect(record).not.toContain('webhook-1');
  });
});

describe('fireEvent — 広告成果の配線(#638)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function adConversionMock() {
    return (await import('./ad-conversion.js')).sendAdConversions as unknown as ReturnType<typeof vi.fn>;
  }

  it('Stripeの購入は安定キー付きで広告成果へ送る', async () => {
    const db = fakeDb({ friend: { line_user_id: 'U1', line_account_id: 'a1' }, capturedInserts: [] });
    await fireEvent(db, 'cv_fire', {
      sourceEventId: 'evt-1',
      sourceKind: 'stripe',
      occurredAt: '2026-09-09T00:00:00+09:00',
      friendId: 'friend-1',
      eventData: { type: 'purchase', amount: 1000, stripeEventId: 'evt-1' },
    }, undefined, 'a1');

    expect(await adConversionMock()).toHaveBeenCalledWith(
      db, 'friend-1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-1', lineAccountId: 'a1', currency: undefined, amountInMinorUnit: undefined },
    );
  });

  it('EC注文確定は発生元IDを安定キーにして送る(正規形・旧形の両方を読む)', async () => {
    const db = fakeDb({ friend: { line_user_id: 'U1', line_account_id: 'a1' }, capturedInserts: [] });
    await fireEvent(db, 'ec.order.confirmed', {
      sourceEventId: 'ev-1',
      sourceKind: 'eccube',
      friendId: 'friend-1',
      eventData: { orderTotal: 2860, order: { number: '123', total: 2860 } },
    }, 'token', 'a1');

    expect(await adConversionMock()).toHaveBeenCalledWith(
      db, 'friend-1', 'Purchase', 2860, { idempotencyKey: 'eccube:ev-1', lineAccountId: 'a1', currency: undefined, amountInMinorUnit: undefined },
    );

    (await adConversionMock()).mockClear();
    await fireEvent(db, 'ec.order.payment_received', {
      sourceEventId: 'ev-2',
      sourceKind: 'eccube',
      friendId: 'friend-1',
      eventData: { order: { total: 1000 } },
    }, 'token', 'a1');

    expect(await adConversionMock()).toHaveBeenCalledWith(
      db, 'friend-1', 'Purchase', 1000, { idempotencyKey: 'eccube:ev-2', lineAccountId: 'a1', currency: undefined, amountInMinorUnit: undefined },
    );
  });

  it('購入に結びつかない通常イベントは送らない', async () => {
    const db = fakeDb({ friend: { line_user_id: 'U1', line_account_id: 'a1' }, capturedInserts: [] });
    await fireEvent(db, 'friend_add', { friendId: 'friend-1', eventData: {} }, undefined, 'a1');

    expect(await adConversionMock()).not.toHaveBeenCalled();
  });

  it('明示の conversionEventName は従来どおり優先する', async () => {
    const db = fakeDb({ friend: { line_user_id: 'U1', line_account_id: 'a1' }, capturedInserts: [] });
    await fireEvent(db, 'custom_event', {
      friendId: 'friend-1',
      conversionEventName: 'Trial',
      conversionValue: 100,
    }, undefined, 'a1');

    expect(await adConversionMock()).toHaveBeenCalledWith(
      db, 'friend-1', 'Trial', 100, { idempotencyKey: undefined, lineAccountId: 'a1', currency: undefined, amountInMinorUnit: undefined },
    );
  });

  it('明示の通貨・単位はそのまま渡す', async () => {
    const db = fakeDb({ friend: { line_user_id: 'U1', line_account_id: 'a1' }, capturedInserts: [] });
    await fireEvent(db, 'custom_event', {
      friendId: 'friend-1',
      conversionEventName: 'Purchase',
      conversionValue: 1000,
      conversionCurrency: 'USD',
      conversionAmountInMinorUnit: true,
    }, undefined, 'a1');

    expect(await adConversionMock()).toHaveBeenCalledWith(
      db, 'friend-1', 'Purchase', 1000,
      { idempotencyKey: undefined, lineAccountId: 'a1', currency: 'USD', amountInMinorUnit: true },
    );
  });
});

describe('fireEvent — EC正規化イベントのV6連携', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const dbModule = await import('@line-crm/db');
    (dbModule.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
    actionScoreMocks.applyActionScoreEvent.mockResolvedValue({
      configured: false,
      status: 'legacy',
      applications: [],
    });
  });

  function ecPayload() {
    return {
      sourceEventId: 'event-12345678',
      sourceKind: 'eccube',
      occurredAt: '2026-08-27T16:00:00.000Z',
      friendId: 'friend-1',
      eventData: { orderNumber: 'NEN-1001', orderTotal: 2860 },
    };
  }

  it('自動化・分析・スコアへ同一イベントIDで渡す', async () => {
    const dbModule = await import('@line-crm/db');
    const triggers = await import('./automation-triggers.js');
    const db = fakeDb({ capturedInserts: [] });

    await fireEvent(db, 'ec.order.confirmed', ecPayload(), 'account-token', 'account-a');

    expect(dbModule.recordAnalyticsEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a',
      friendId: 'friend-1',
      eventType: 'ec.order.confirmed',
      sourceKind: 'eccube',
      sourceId: 'event-12345678',
      occurredAt: '2026-08-27T16:00:00.000Z',
    }));
    expect(actionScoreMocks.applyActionScoreEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a',
      friendId: 'friend-1',
      eventType: 'ec.order.confirmed',
      source: 'eccube',
      sourceEventId: 'event-12345678',
    }));
    expect(triggers.dispatchAutomationEventWithLogging).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a',
      eventType: 'ec.order.confirmed',
      sourceEventId: 'event-12345678',
      friendId: 'friend-1',
    }));
  });

  it('分析の記録に失敗しても自動化への連携は止めない', async () => {
    const dbModule = await import('@line-crm/db');
    const triggers = await import('./automation-triggers.js');
    (dbModule.recordAnalyticsEvent as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(new Error('analytics_event_type_unknown:ec.order.cancelled'));
    const db = fakeDb({ capturedInserts: [] });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await fireEvent(db, 'ec.order.cancelled', {
      ...ecPayload(),
      sourceEventId: 'event-cancel-1',
    }, 'account-token', 'account-a');

    expect(triggers.dispatchAutomationEventWithLogging).toHaveBeenCalledWith(db, expect.objectContaining({
      lineAccountId: 'account-a',
      eventType: 'ec.order.cancelled',
      sourceEventId: 'event-cancel-1',
    }));
    errorLog.mockRestore();
  });

  it('アカウントが分からないイベントはV6自動化へ渡さない', async () => {
    const triggers = await import('./automation-triggers.js');
    const db = fakeDb({ capturedInserts: [] });

    await fireEvent(db, 'ec.order.confirmed', {
      sourceEventId: 'event-no-account',
      friendId: 'friend-1',
      eventData: { orderNumber: 'NEN-1001' },
    }, 'account-token');

    expect(triggers.dispatchAutomationEventWithLogging).not.toHaveBeenCalled();
  });
});

describe('fireEvent — 旧式 send_webhook は共通の安全送信へ通す', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function fireLegacyWebhook(url: string) {
    const dbModule = await import('@line-crm/db');
    (dbModule.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([
        {
          id: 'auto-legacy',
          line_account_id: null,
          conditions: JSON.stringify({}),
          actions: JSON.stringify([{ type: 'send_webhook', params: { url } }]),
        },
      ]);
    (dbModule.getActiveOutgoingWebhooksByEvent as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue([]);
    const db = fakeDb({ capturedInserts: [] });
    await fireEvent(db, 'message_received', { friendId: 'friend-1', eventData: {} });
    return dbModule.createAutomationLog as unknown as { mock: { calls: unknown[][] } };
  }

  it('安全でない直書きURLは送らず失敗に残す', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('送ってはいけない');
    });
    vi.stubGlobal('fetch', fetchMock);

    const createAutomationLog = await fireLegacyWebhook('http://169.254.169.254/x');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createAutomationLog.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ status: 'failed' }));
    const result = JSON.parse((createAutomationLog.mock.calls[0]?.[1] as { actionsResult: string }).actionsResult);
    expect(result).toEqual([{ action: 'send_webhook', success: false, error: expect.stringContaining('send_webhook_url_unsafe') }]);
  });

  it('公開HTTPSの直書きURLは名前を引き直して送る', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        seen.push(url);
        if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
          const type = new URL(url).searchParams.get('type');
          return new Response(
            JSON.stringify({
              Status: 0,
              Answer: [{
                name: 'hooks.example.com.',
                type: type === 'A' ? 1 : 28,
                TTL: 60,
                data: type === 'A' ? '93.184.216.34' : '2606:4700:4700::1111',
              }],
            }),
            { status: 200 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    const createAutomationLog = await fireLegacyWebhook('https://hooks.example.com/ping');

    expect(seen).toContain('https://hooks.example.com/ping');
    expect(createAutomationLog.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ status: 'success' }));
  });
});
