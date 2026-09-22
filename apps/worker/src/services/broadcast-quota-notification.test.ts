/*
 * IDEA-24 (#1042): 送信枠不足の通知が通知センターへ届く契約試験。
 *
 * 背景: `guardScheduledBroadcastQuota` は「止めた理由」を
 * `channel: 'center'` で書いていたが、通知センターは 'dashboard' しか
 * 読まなかったため、書き込み済みの通知が誰にも見えなかった。
 * このファイルは次の2点を固定する。
 *
 *  1. 新しく書く通知は通知センターが読む channel に乗る
 *  2. 既に 'center' で書き込まれた過去分も読み出し・既読化できる
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNotification,
  getNotificationCenter,
  getNotificationCenterCounts,
  markAllNotificationsRead,
  markNotificationRead,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { guardScheduledBroadcastQuota } from './broadcast.js';

function seedBase(db: SqliteD1) {
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
  db.raw.prepare(`
    INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id)
    VALUES ('f-1', 'U-friend-1', '友だち1', 1, 'account-1'),
           ('f-2', 'U-friend-2', '友だち2', 1, 'account-1')
  `).run();
}

describe('送信枠不足の通知が通知センターへ届く', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedBase(testDb);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('枠不足で止めたとき、通知は通知センターが読む channel で書かれる', async () => {
    // 上限1・使用済み1 → 残り0。友だち2人分は送れない。
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/quota')) {
        return new Response(JSON.stringify({ type: 'limited', value: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ totalUsage: 1 }), { status: 200 });
    }));

    const broadcast = {
      id: 'b-1', title: 'セール告知', target_type: 'all', target_tag_id: null,
    } as Broadcast;
    const result = await guardScheduledBroadcastQuota(testDb.db, broadcast, 'account-1');

    expect(result.blocked).toBe(true);
    const written = testDb.raw.prepare(
      `SELECT channel, category, event_type FROM notifications WHERE line_account_id = 'account-1'`,
    ).get() as { channel: string; category: string; event_type: string };
    expect(written).toMatchObject({
      channel: 'dashboard',
      category: 'error',
      event_type: 'broadcast.quota_short',
    });
    // 書いた通知が実際に通知センターから読めることまで確かめる。
    const items = await getNotificationCenter(testDb.db, {
      lineAccountId: 'account-1', staffId: 'staff-1',
    });
    expect(items.map((item) => item.event_type)).toEqual(['broadcast.quota_short']);
  });

  it('過去に channel=center で書かれた通知も一覧・件数・既読の対象になる', async () => {
    await createNotification(testDb.db, {
      eventType: 'broadcast.quota_short',
      title: '「セール告知」を送れませんでした',
      body: '残りが足りません',
      channel: 'center',
      category: 'error',
      lineAccountId: 'account-1',
    });
    await createNotification(testDb.db, {
      eventType: 'booking_created',
      title: '新しい予約',
      body: '予約が入りました',
      channel: 'dashboard',
      category: 'update',
      lineAccountId: 'account-1',
    });
    // 外部向けなど別channelの通知は対象外のまま。
    await createNotification(testDb.db, {
      eventType: 'debug',
      title: '内部メモ',
      body: '画面には出ない',
      channel: 'internal',
      category: 'info',
      lineAccountId: 'account-1',
    });

    const items = await getNotificationCenter(testDb.db, {
      lineAccountId: 'account-1', staffId: 'staff-1',
    });
    expect(items.map((item) => item.event_type).sort())
      .toEqual(['booking_created', 'broadcast.quota_short']);

    const counts = await getNotificationCenterCounts(testDb.db, {
      lineAccountId: 'account-1', staffId: 'staff-1',
    });
    expect(counts).toEqual({ all: 2, error: 1, update: 1, unread: 2 });

    const centerRow = items.find((item) => item.channel === 'center')!;
    expect(await markNotificationRead(testDb.db, {
      notificationId: centerRow.id, lineAccountId: 'account-1', staffId: 'staff-1',
    })).toBe(true);
    expect((await getNotificationCenterCounts(testDb.db, {
      lineAccountId: 'account-1', staffId: 'staff-1',
    })).unread).toBe(1);

    // 「すべて既読」でも取りこぼさない。
    await markAllNotificationsRead(testDb.db, {
      lineAccountId: 'account-1', staffId: 'staff-1',
    });
    expect((await getNotificationCenterCounts(testDb.db, {
      lineAccountId: 'account-1', staffId: 'staff-1',
    })).unread).toBe(0);
  });
});
