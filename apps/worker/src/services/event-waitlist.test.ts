import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  enqueueEventWaitlistPromotion,
  getEventOccurrenceApplicants,
  processEventWaitlistPromotionJobs,
  promoteEventWaitlist,
} from './event-waitlist.js';
import type { EventWaitlistOfferSender } from './event-waitlist.js';

function asD1(sqlite: Database.Database): D1Database {
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
