/*
 * m22o (R52の限界・オーナー決定 2026-09-28):
 * 付与ルールの期限・取消・通知を実際の付与に効かせる。
 * 公開版(v1以降)の設定だけを使い、下書きの設定は使わない。
 * 既存の付与済みマイルは変えない。
 *
 * 実SQLite（better-sqlite3 + bootstrap.sql）に実物の保存・公開・付与関数を当て、
 * 監査の再現手順（booking_created → 300マイル）をなぞる。
 * 通知の外部送信だけ差し替え（mock）し、本文の予約までは実物で確かめる。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueMileageEvent,
  getPublishedVersionContent,
  processPendingMileageEvents,
} from '@line-crm/db';
import { createMileageRule } from '@line-crm/db';
import {
  publishMileageEarningRule,
  saveMileageEarningRuleDraft,
} from '@line-crm/db';

const dispatchLineProxyLocally = vi.hoisted(() => vi.fn());
const pushViaHarnessProxy = vi.hoisted(() => vi.fn(async () => ({ requestId: 'line-request-1' })));
vi.mock('./local-line-proxy.js', () => ({ dispatchLineProxyLocally }));
vi.mock('./line-proxy-send.js', () => ({ pushViaHarnessProxy }));

const { deliverDueMileageGrantNotifications } = await import('./mileage-grant-notification.js');

const bootstrap = readFileSync(join(process.cwd(), '../../packages/db/bootstrap.sql'), 'utf8');

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} }),
    run: async <T>() => {
      const info = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: info.changes } } as T;
    },
  });
  return {
    prepare: (sql: string) => {
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        ...wrap(sql, params),
      }) as unknown as D1PreparedStatement;
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  } as unknown as D1Database;
}

const ACCOUNT = 'account-m22o';
const FRIEND = { id: 'friend-m22o-1', lineUserId: 'U-m22o-1', displayName: 'たろう' };

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = new Database(':memory:');
  sqlite.exec(bootstrap);
  db = asD1(sqlite);
  dispatchLineProxyLocally.mockResolvedValue(
    new Response(null, { status: 200, headers: { 'x-line-request-id': 'line-request-1' } }),
  );
});

type RuleSettings = {
  expiresAfterDays: number | null;
  cancellationEventTypes: string[];
  notification: { enabled: boolean; messageTemplate: string };
};

async function setupPublishedRule(settings: RuleSettings, keySuffix: string) {
  sqlite
    .prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, ?, ?)`)
    .run(ACCOUNT, 'ch-m22o', 'm22o確認用', 'token', 'secret');
  sqlite
    .prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following) VALUES (?, ?, ?, ?, 1)`)
    .run(FRIEND.id, FRIEND.lineUserId, FRIEND.displayName, ACCOUNT);
  const rule = await createMileageRule(db, {
    name: '予約でたまる',
    eventType: 'booking_created',
    amount: 300,
    lineAccountId: ACCOUNT,
  });
  await saveMileageEarningRuleDraft(db, {
    ruleId: rule.id,
    lineAccountId: ACCOUNT,
    expectedVersion: null,
    draft: {
      name: '予約でたまる',
      eventType: 'booking_created',
      source: null,
      amount: 300,
      initialStatus: 'available',
      validFrom: null,
      validUntil: null,
      expiresAfterDays: settings.expiresAfterDays,
      cancellationEventTypes: settings.cancellationEventTypes,
      targetConditions: null,
      sortOrder: 0,
      notification: settings.notification,
    },
  });
  const published = await publishMileageEarningRule(db, {
    ruleId: rule.id,
    lineAccountId: ACCOUNT,
    expectedVersion: 1,
    idempotencyKey: `m22o-publish-${keySuffix}`,
  });
  return { ruleId: rule.id, versionNumber: published.versionNumber };
}

const FULL: RuleSettings = {
  expiresAfterDays: 30,
  cancellationEventTypes: ['booking_cancelled'],
  notification: { enabled: true, messageTemplate: '付与 {awardedMiles} 残高 {balance}' },
};
const BARE: RuleSettings = {
  expiresAfterDays: null,
  cancellationEventTypes: [],
  notification: { enabled: false, messageTemplate: '' },
};

function grants() {
  return sqlite
    .prepare(`SELECT id, amount, status, metadata, occurred_at AS occurredAt, source_event_id AS sourceEventId, reverses_entry_id AS reversesEntryId FROM mileage_ledger WHERE entry_type = 'grant' ORDER BY created_at, id`)
    .all() as Array<{ id: string; amount: number; status: string; metadata: string | null; occurredAt: string; sourceEventId: string | null; reversesEntryId: string | null }>;
}

function reversals() {
  return sqlite
    .prepare(`SELECT id, amount, reverses_entry_id AS reversesEntryId FROM mileage_ledger WHERE entry_type = 'reversal' ORDER BY created_at, id`)
    .all() as Array<{ id: string; amount: number; reversesEntryId: string | null }>;
}

function notifications() {
  return sqlite
    .prepare(`SELECT ledger_entry_id AS ledgerEntryId, status, message_text AS message FROM mileage_adjustment_notifications ORDER BY created_at, id`)
    .all() as Array<{ ledgerEntryId: string; status: string; message: string }>;
}

function lotExpiry(ledgerId: string) {
  return sqlite
    .prepare(`SELECT expires_at AS expiresAt FROM mileage_grant_lots WHERE ledger_entry_id = ?`)
    .get(ledgerId) as { expiresAt: string | null } | undefined;
}

describe('m22o 付与ルールの期限・取消・通知', () => {
  it('公開版に下書きの期限・取消・通知が残る', async () => {
    const { ruleId, versionNumber } = await setupPublishedRule(FULL, 'content');
    const content = await getPublishedVersionContent(db, ruleId, versionNumber);
    expect(content?.expires_after_days).toBe(30);
    expect(content?.cancellation_event_types).toEqual(['booking_cancelled']);
    expect(content?.notification).toEqual({ enabled: true, messageTemplate: '付与 {awardedMiles} 残高 {balance}' });
  });

  it('期限ONなら付与に有効期限が付き、OFFなら付かない', async () => {
    await setupPublishedRule(FULL, 'expiry-on');
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-on-1', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    const [grant] = grants();
    expect(grant?.amount).toBe(300);
    const metadata = JSON.parse(grant?.metadata ?? '{}') as { expiresAt?: string };
    expect(metadata.expiresAt).toBeDefined();
    expect(Date.parse(metadata.expiresAt ?? '') - Date.parse(grant?.occurredAt ?? '')).toBe(30 * 86400_000);
    expect(lotExpiry(grant!.id)?.expiresAt).toBe(metadata.expiresAt);
  });

  it('期限OFFなら有効期限を付けない', async () => {
    await setupPublishedRule(BARE, 'expiry-off');
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-off-1', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    const [grant] = grants();
    expect(grant?.amount).toBe(300);
    const metadata = JSON.parse(grant?.metadata ?? '{}') as { expiresAt?: string };
    expect(metadata.expiresAt).toBeUndefined();
    expect(lotExpiry(grant!.id)?.expiresAt).toBeNull();
  });

  it('取消ONなら取消イベントで付与を取り消し、別の予約の付与は残す', async () => {
    await setupPublishedRule(FULL, 'cancel-on');
    for (const sourceEventId of ['booking-keep', 'booking-cancel']) {
      await enqueueMileageEvent(db, {
        eventType: 'booking_created', source: 'booking', sourceEventId, friendId: FRIEND.id,
      });
    }
    await processPendingMileageEvents(db, { limit: 10 });
    expect(grants()).toHaveLength(2);
    await enqueueMileageEvent(db, {
      eventType: 'booking_cancelled', source: 'booking', sourceEventId: 'booking-cancel', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    // 取消イベント自体では新たに付けない
    expect(grants()).toHaveLength(2);
    const cancelled = grants().find((item) => item.sourceEventId === 'booking-cancel');
    const kept = grants().find((item) => item.sourceEventId === 'booking-keep');
    const reversed = reversals();
    expect(reversed).toHaveLength(1);
    expect(reversed[0]?.amount).toBe(-300);
    expect(reversed[0]?.reversesEntryId).toBe(cancelled?.id);
    // 別の予約の付与に取消は触らない
    expect(reversed.some((item) => item.reversesEntryId === kept?.id)).toBe(false);
  });

  it('取消OFFなら取消イベントで取り消さない', async () => {
    await setupPublishedRule(BARE, 'cancel-off');
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-1', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    await enqueueMileageEvent(db, {
      eventType: 'booking_cancelled', source: 'booking', sourceEventId: 'booking-1', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    expect(grants()).toHaveLength(1);
    expect(reversals()).toHaveLength(0);
  });

  it('通知ONなら付与の後に通知を予約し、OFFなら予約しない', async () => {
    await setupPublishedRule(FULL, 'notify-on');
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-n1', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    const [grant] = grants();
    const reserved = notifications();
    expect(reserved).toHaveLength(1);
    expect(reserved[0]?.ledgerEntryId).toBe(grant?.id);
    expect(reserved[0]?.status).toBe('pending');
    // 見本の差し込み（{awardedMiles}・{balance}）が値で埋まる
    expect(reserved[0]?.message).toContain('付与 300');
    expect(reserved[0]?.message).toContain('残高 300');
    expect(reserved[0]?.message).not.toContain('{');
  });

  it('通知OFFなら通知を予約しない', async () => {
    await setupPublishedRule(BARE, 'notify-off');
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-n2', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    expect(grants()).toHaveLength(1);
    expect(notifications()).toHaveLength(0);
  });

  it('予約した通知を届け、届けたら二重に送らない', async () => {
    await setupPublishedRule(FULL, 'notify-deliver');
    await enqueueMileageEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-n3', friendId: FRIEND.id,
    });
    await processPendingMileageEvents(db, { limit: 10 });
    expect(notifications()).toHaveLength(1);
    const first = await deliverDueMileageGrantNotifications(
      { db, workerPublicUrl: 'https://worker.example.com', dispatch: dispatchLineProxyLocally },
      { limit: 20 },
    );
    expect(first).toMatchObject({ delivered: 1, failed: 0 });
    expect(notifications()[0]?.status).toBe('sent');
    expect(pushViaHarnessProxy).toHaveBeenCalledTimes(1);
    expect((pushViaHarnessProxy.mock.calls[0] as unknown[] | undefined)?.[2]).toBe(FRIEND.lineUserId);
    const second = await deliverDueMileageGrantNotifications(
      { db, workerPublicUrl: 'https://worker.example.com', dispatch: dispatchLineProxyLocally },
      { limit: 20 },
    );
    expect(second).toMatchObject({ delivered: 0, failed: 0 });
    expect(pushViaHarnessProxy).toHaveBeenCalledTimes(1);
  });
});
