import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createEventApplicantSnapshot,
  EVENT_APPLICANT_SNAPSHOT_TTL_MS,
  getEventApplicantSnapshot,
} from './event-applicant-snapshot.js';

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (query: string): D1PreparedStatement => {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      all: async <T,>() => ({ results: (statement.reader ? statement.all(...params) : []) as T[] }),
      first: async <T,>() => (statement.reader ? statement.get(...params) : null) as T | null,
      run: async () => ({ meta: { changes: statement.run(...params).changes } }),
    } as unknown as D1PreparedStatement);
    return bound([]);
  };
  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => Promise.all(statements.map((statement: D1PreparedStatement) => statement.run())),
  } as unknown as D1Database;
}

describe('event applicant snapshot', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  const now = new Date('2026-09-16T00:00:00.000Z');
  const data = {
    occurrence: { id: 'slot-a', eventId: 'event-a', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-01T01:00:00.000Z', capacity: 3, activeSeats: 1, version: 2 },
    summary: { bookingCount: 1, waitingCount: 1, activeSeats: 1, confirmedSeats: 1, requestedSeats: 0, waitingSeats: 1, offeredSeats: 0, remainingSeats: 2 },
    applicants: [{ source: 'booking' as const, id: 'booking-a', friendId: 'friend-a', displayName: '田中', pictureUrl: null, status: 'confirmed', partySize: 1, appliedAt: '2026-09-15T00:00:00.000Z', answers: null, firstParticipation: { isFirst: null, attendedCount: null, checkedAt: null }, offeredAt: null, offerExpiresAt: null }],
  };

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'), 'utf8'));
    sqlite.exec("INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret) VALUES ('account-a', 'A', 'c', 't', 's')");
    sqlite.exec("INSERT INTO events (id, line_account_id, name, target_type) VALUES ('event-a', 'account-a', 'event', 'single')");
    sqlite.exec("INSERT INTO event_slots (id, event_id, starts_at, ends_at) VALUES ('slot-a', 'event-a', '2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z')");
    db = asD1(sqlite);
  });
  afterEach(() => sqlite.close());

  test('表示時の対象を保存し、後続の変更を読まずCSV/previewで同じ担当者だけへ返す', async () => {
    const created = await createEventApplicantSnapshot(db, { lineAccountId: 'account-a', occurrenceId: 'slot-a', staffId: 'staff-a', data, now });
    const loaded = await getEventApplicantSnapshot(db, { id: created.id, lineAccountId: 'account-a', occurrenceId: 'slot-a', staffId: 'staff-a', now: new Date(now.getTime() + 1) });
    expect(loaded).toMatchObject({ kind: 'found', snapshot: { id: created.id, data } });
    await expect(getEventApplicantSnapshot(db, { id: created.id, lineAccountId: 'account-a', occurrenceId: 'slot-a', staffId: 'staff-b', now })).resolves.toEqual({ kind: 'not_found' });
    await expect(getEventApplicantSnapshot(db, { id: created.id, lineAccountId: 'account-a', occurrenceId: 'slot-a', staffId: 'staff-a', now: new Date(now.getTime() + EVENT_APPLICANT_SNAPSHOT_TTL_MS) })).resolves.toEqual({ kind: 'expired' });
  });
});
