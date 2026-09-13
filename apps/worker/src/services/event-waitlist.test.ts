import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createEventWaitlistOfferSender,
  enqueueEventWaitlistPromotion,
  getEventOccurrenceApplicants,
  processEventWaitlistPromotionJobs,
  promoteEventWaitlist,
} from './event-waitlist.js';
import type { EventWaitlistOfferSender } from './event-waitlist.js';

function asD1(sqlite: Database.Database, beforeRun?: (query: string) => Promise<void>): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        if (beforeRun) await beforeRun(query);
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('V6 event waitlist and applicants', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-a', 'channel-a', 'A店', 'token-a', 'secret-a'),
             ('account-b', 'channel-b', 'B店', 'token-b', 'secret-b');
      INSERT INTO friends (id, line_user_id, display_name, picture_url, line_account_id)
      VALUES ('friend-a', 'Ua', '田中さん', 'https://example.test/a.png', 'account-a'),
             ('friend-b', 'Ub', '鈴木さん', NULL, 'account-a'),
             ('friend-c', 'Uc', '佐藤さん', NULL, 'account-a');
      INSERT INTO events (id, line_account_id, name, venue_name, venue_url, target_type)
      VALUES ('event-a', 'account-a', 'しつけ教室', '教室A', 'https://example.test/map', 'single');
      INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
      VALUES ('slot-a', 'event-a', '2099-06-01T01:00:00.000Z', '2099-06-01T03:00:00.000Z', 3),
             ('slot-empty', 'event-a', '2099-06-02T01:00:00.000Z', '2099-06-02T03:00:00.000Z', 3),
             ('slot-past', 'event-a', '2020-06-01T01:00:00.000Z', '2020-06-01T03:00:00.000Z', 3);
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  function seedBooking(): void {
    sqlite.exec(`
      INSERT INTO event_bookings (
        id, line_account_id, event_id, slot_id, friend_id, status, requested_at,
        identity_key, party_size, answer_snapshot_json, first_participation,
        first_participation_attended_count, first_participation_checked_at
      ) VALUES (
        'booking-a', 'account-a', 'event-a', 'slot-a', 'friend-a', 'confirmed',
        '2026-09-01T00:00:00.000Z', 'friend-a', 2,
        '{"companion":"母","pet":"ポチ"}', 1, 0, '2026-09-01T00:00:00.000Z'
      );
    `);
  }

  function seedWaitlist(): void {
    sqlite.exec(`
      INSERT INTO event_waitlist (
        id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
        party_size, answer_snapshot_json, first_participation,
        first_participation_attended_count, first_participation_checked_at,
        created_at, updated_at
      ) VALUES (
        'wait-a', 'account-a', 'event-a', 'slot-a', 'friend-b', 'friend-b', 'waiting',
        1, '{"pet":"ミミ"}', 0, 2, '2026-09-01T01:00:00.000Z',
        '2026-09-01T01:00:00.000Z', '2026-09-01T01:00:00.000Z'
      );
    `);
  }

  test('normal: 申込時点の人数・回答・初回判定を同じアカウントへ返す', async () => {
    seedBooking();
    seedWaitlist();
    const data = await getEventOccurrenceApplicants(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a',
    });
    expect(data).toMatchObject({
      occurrence: { id: 'slot-a', eventId: 'event-a', capacity: 3, activeSeats: 2, version: 1 },
      summary: { bookingCount: 1, waitingCount: 1, activeSeats: 2 },
      applicants: [
        {
          source: 'booking', friendId: 'friend-a', partySize: 2,
          answers: { companion: '母', pet: 'ポチ' },
          firstParticipation: { isFirst: true, attendedCount: 0 },
        },
        {
          source: 'waitlist', friendId: 'friend-b', partySize: 1,
          answers: { pet: 'ミミ' },
          firstParticipation: { isFirst: false, attendedCount: 2 },
        },
      ],
    });
  });

  test('empty / forbidden: 空の開催回と所属外アカウントを区別する', async () => {
    await expect(getEventOccurrenceApplicants(db, {
      occurrenceId: 'slot-empty', lineAccountId: 'account-a',
    })).resolves.toMatchObject({ summary: { bookingCount: 0, waitingCount: 0 }, applicants: [] });
    await expect(getEventOccurrenceApplicants(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-b',
    })).resolves.toBeNull();
  });

  test('normal / conflict: 先頭へ24時間だけ保留し、同じ版では二重に繰り上げない', async () => {
    seedBooking();
    seedWaitlist();
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    const now = new Date('2026-09-07T00:00:00.000Z');
    const promoted = await promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', expectedVersion: 1, now, sender,
    });
    expect(promoted).toMatchObject({
      kind: 'promoted', occurrenceVersion: 2,
      promoted: { waitlistId: 'wait-a', friendId: 'friend-b', partySize: 1, status: 'offered' },
    });
    expect(sender).toHaveBeenCalledOnce();
    const sent = sender.mock.calls[0][0];
    expect(sent.expiresAt).toBe('2026-09-08T00:00:00.000Z');
    const stored = sqlite.prepare(
      `SELECT status, offer_token_hash, notified_at FROM event_waitlist WHERE id = 'wait-a'`,
    ).get() as { status: string; offer_token_hash: string; notified_at: string };
    expect(stored.status).toBe('offered');
    expect(stored.offer_token_hash).not.toBe(sent.token);
    expect(stored.notified_at).toBe(now.toISOString());

    await expect(promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', expectedVersion: 1, now, sender,
    })).resolves.toEqual({ kind: 'conflict', currentVersion: 2 });
  });

  test('同じ枠に成立済み予約があれば、本人上限なしでも再度繰り上げない', async () => {
    seedBooking();
    seedWaitlist();
    sqlite.exec(`UPDATE events SET max_bookings_per_friend = NULL;
                UPDATE event_bookings SET identity_key = 'friend-b' WHERE id = 'booking-a';`);
    const before = sqlite.prepare(`SELECT * FROM event_waitlist`).all();
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    expect(await promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', sender,
    })).toMatchObject({ kind: 'noop', reason: 'applicant_ineligible' });
    expect(sender).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT * FROM event_waitlist`).all()).toEqual(before);
  });

  test('繰上げ候補の読み取り後に別枠の予約が成立しても、案内確保の文で本人上限を守る', async () => {
    seedWaitlist();
    sqlite.exec(`UPDATE events SET max_bookings_per_friend = 1`);
    let reached!: () => void;
    let resume!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    db = asD1(sqlite, async query => {
      if (/SET status = 'offered'/.test(query)) { reached(); await released; }
    });
    const before = sqlite.prepare(`SELECT * FROM event_waitlist`).all();
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    const promotion = promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', sender,
    });
    await ready;
    sqlite.exec(`INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, identity_key, status, requested_at)
      VALUES ('other-booking', 'account-a', 'event-a', 'slot-empty', 'friend-b',
              'friend-b', 'confirmed', '2026-09-01T00:00:00.000Z')`);
    resume();
    expect(await promotion).toMatchObject({ kind: 'noop', reason: 'applicant_ineligible' });
    expect(sender).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT * FROM event_waitlist`).all()).toEqual(before);
  });

  test('別枠で同一人物に保留中の席がある場合も、本人上限を超えて案内しない', async () => {
    seedWaitlist();
    sqlite.exec(`UPDATE events SET max_bookings_per_friend = 1;
      INSERT INTO event_waitlist (id, line_account_id, event_id, slot_id, friend_id, identity_key,
        status, offered_at, offer_expires_at, created_at, updated_at)
      VALUES ('other-offer', 'account-a', 'event-a', 'slot-empty', 'friend-b', 'friend-b',
        'offered', '2026-09-01', '2099-05-01', '2026-09-01', '2026-09-01')`);
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    expect(await promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', sender,
    })).toMatchObject({ kind: 'noop', reason: 'applicant_ineligible' });
    expect(sender).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT status FROM event_waitlist WHERE id = 'wait-a'`).get())
      .toEqual({ status: 'waiting' });
  });

  test('通知失敗は成立扱いにせず待機へ戻す', async () => {
    seedBooking();
    seedWaitlist();
    await expect(promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', expectedVersion: 1,
      now: new Date('2026-09-07T00:00:00.000Z'),
      sender: async () => { throw new Error('LINE temporary error'); },
    })).rejects.toThrow('LINE temporary error');
    expect(sqlite.prepare(
      `SELECT status, offered_at, offer_expires_at, offer_token_hash FROM event_waitlist WHERE id = 'wait-a'`,
    ).get()).toEqual({ status: 'waiting', offered_at: null, offer_expires_at: null, offer_token_hash: null });
  });

  test.each(['accepted', 'offered'])('空席確認後に増えた%sの保留人数も確保のSQLで数える', async status => {
    seedWaitlist();
    sqlite.exec(`UPDATE event_waitlist SET party_size = 2`);
    const before = sqlite.prepare(`SELECT * FROM event_waitlist WHERE id = 'wait-a'`).get();
    // offeredは期限切れでも、失効処理前の保留行として席数へ含める。
    db = asD1(sqlite, async query => {
      if (!/SET status = 'offered'/.test(query)) return;
      sqlite.prepare(`INSERT INTO event_waitlist
        (id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
         party_size, offered_at, offer_expires_at, created_at, updated_at)
        VALUES ('held', 'account-a', 'event-a', 'slot-a', 'friend-c', 'friend-c', ?,
          2, '2026-09-01', '2026-09-02', '2026-09-01', '2026-09-01')`).run(status);
    });
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    expect(await promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', sender,
      now: new Date('2026-09-07T00:00:00.000Z'),
    })).toMatchObject({ kind: 'noop', reason: 'party_too_large' });
    expect(sender).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT * FROM event_waitlist WHERE id = 'wait-a'`).get()).toEqual(before);
  });

  test.each([1, null])('空席確認後に定員が%sへ変わったら古い容量で案内しない', async capacity => {
    seedWaitlist();
    sqlite.exec(`UPDATE event_waitlist SET party_size = 2`);
    const before = sqlite.prepare(`SELECT * FROM event_waitlist`).all();
    db = asD1(sqlite, async query => {
      if (/SET status = 'offered'/.test(query)) {
        sqlite.prepare(`UPDATE event_slots SET capacity = ? WHERE id = 'slot-a'`).run(capacity);
      }
    });
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    expect(await promoteEventWaitlist(db, {
      occurrenceId: 'slot-a', lineAccountId: 'account-a', sender,
    })).toMatchObject({ kind: 'noop', reason: capacity == null ? 'no_capacity' : 'party_too_large' });
    expect(sender).not.toHaveBeenCalled();
    expect(sqlite.prepare(`SELECT * FROM event_waitlist`).all()).toEqual(before);
  });

  test('暗号化済みトークンだけのアカウントを送信先なしと誤判定しない', async () => {
    sqlite.prepare(
      `UPDATE line_accounts
          SET channel_access_token = '', channel_access_token_encrypted = 'invalid-ciphertext'
        WHERE id = 'account-a'`,
    ).run();
    const sender = createEventWaitlistOfferSender(db, {});

    await expect(sender({
      waitlistId: 'wait-a',
      lineAccountId: 'account-a',
      friendId: 'friend-a',
      eventName: 'しつけ教室',
      startsAt: '2099-06-01T01:00:00.000Z',
      venueName: '教室A',
      venueUrl: null,
      token: 'offer-token',
      expiresAt: '2099-06-02T01:00:00.000Z',
    })).rejects.not.toThrow('waitlist_notification_destination_missing');
  });

  test('Cron: 席解放jobを一度だけ処理し、一時失敗は再試行可能に残す', async () => {
    seedBooking();
    seedWaitlist();
    sqlite.prepare(`UPDATE event_bookings SET status = 'cancelled' WHERE id = 'booking-a'`).run();
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(await enqueueEventWaitlistPromotion(db, {
      lineAccountId: 'account-a', eventId: 'event-a', occurrenceId: 'slot-a',
      sourceKey: 'booking:booking-a:cancelled', now,
    })).toBe(true);
    expect(await enqueueEventWaitlistPromotion(db, {
      lineAccountId: 'account-a', eventId: 'event-a', occurrenceId: 'slot-a',
      sourceKey: 'booking:booking-a:cancelled', now,
    })).toBe(false);

    const first = await processEventWaitlistPromotionJobs(db, {
      now, sender: async () => { throw new Error('temporary'); },
    });
    expect(first).toEqual({ processed: 1, promoted: 0, retried: 1 });
    expect(sqlite.prepare(
      `SELECT status, attempts, last_error FROM event_waitlist_promotion_jobs`,
    ).get()).toEqual({ status: 'retryable_failed', attempts: 1, last_error: 'temporary' });

    const retryAt = new Date(now.getTime() + 2 * 60_000);
    const second = await processEventWaitlistPromotionJobs(db, {
      now: retryAt, sender: async () => undefined,
    });
    expect(second).toEqual({ processed: 1, promoted: 1, retried: 0 });
    expect(sqlite.prepare(`SELECT status FROM event_waitlist_promotion_jobs`).get())
      .toEqual({ status: 'completed' });
  });

  test('開催後は自動繰り上げしない', async () => {
    sqlite.exec(`
      INSERT INTO event_waitlist (
        id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
        created_at, updated_at
      ) VALUES (
        'wait-past', 'account-a', 'event-a', 'slot-past', 'friend-b', 'friend-b',
        'waiting', '2020-05-01T00:00:00.000Z', '2020-05-01T00:00:00.000Z'
      );
    `);
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    await expect(promoteEventWaitlist(db, {
      occurrenceId: 'slot-past', lineAccountId: 'account-a', expectedVersion: 1,
      now: new Date('2026-09-07T00:00:00.000Z'), sender,
    })).resolves.toMatchObject({ kind: 'noop', reason: 'occurrence_started' });
    expect(sender).not.toHaveBeenCalled();
  });

  test('24時間の保留が切れたら履歴を残して次の候補へ進む', async () => {
    sqlite.exec(`
      INSERT INTO event_waitlist (
        id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
        offered_at, offer_expires_at, offer_token_hash, notified_at,
        created_at, updated_at
      ) VALUES (
        'wait-old', 'account-a', 'event-a', 'slot-a', 'friend-b', 'friend-b', 'offered',
        '2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z', 'old-hash',
        '2026-09-05T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z'
      );
      INSERT INTO event_waitlist (
        id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
        created_at, updated_at
      ) VALUES (
        'wait-next', 'account-a', 'event-a', 'slot-a', 'friend-c', 'friend-c', 'waiting',
        '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'
      );
    `);
    const sender = vi.fn<EventWaitlistOfferSender>().mockResolvedValue(undefined);
    const result = await processEventWaitlistPromotionJobs(db, {
      now: new Date('2026-09-07T00:00:00.000Z'), sender,
    });
    expect(result).toEqual({ processed: 1, promoted: 1, retried: 0 });
    expect(sqlite.prepare(
      `SELECT id, status FROM event_waitlist ORDER BY created_at`,
    ).all()).toEqual([
      { id: 'wait-old', status: 'expired' },
      { id: 'wait-next', status: 'offered' },
    ]);
    expect(sqlite.prepare(`SELECT version FROM event_slots WHERE id = 'slot-a'`).get())
      .toEqual({ version: 3 });
  });
});
