// U の土台（状態・変更確認・待ちの手動操作）の試験。
// 実 sqlite（bootstrap 適用済み）で動きを守る。権限・範囲・
// 失敗・二重実行は route 側の試験（events-u.test.ts）でも守る。
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  applyEventChange,
  canTransitionLifecycle,
  isLifecycleStatus,
  lifecycleReasonRequired,
  lifecycleToPublishedFlag,
  previewEventChange,
} from './event-change-review.js';
import { reorderEventWaitlist, skipEventWaitlist } from './event-waitlist.js';

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
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

const DAY_MS = 24 * 3600_000;
const futureIso = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

let sqlite: Database.Database;
let db: D1Database;

function seedBase(options?: { published?: boolean; capacity?: number | null }): {
  eventId: string;
  slotId: string;
} {
  const eventId = 'e1';
  const slotId = 's1';
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('la1', 'ch1', 'A店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('f1', 'U1', '田中さん', 'la1'),
           ('f2', 'U2', '鈴木さん', 'la1'),
           ('f3', 'U3', '佐藤さん', 'la1');
    INSERT INTO events (id, line_account_id, name, is_published,
      cancel_deadline_hours_before, requires_approval, waitlist_enabled)
    VALUES ('${eventId}', 'la1', '秋のしつけ教室', ${options?.published ? 1 : 0}, 24, 0, 1);
    INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
    VALUES ('${slotId}', '${eventId}', '${futureIso(7)}', '${futureIso(7.1)}',
      ${options?.capacity === undefined ? 2 : (options.capacity ?? 'NULL')});
  `);
  return { eventId, slotId };
}

function addBooking(id: string, slotId: string, friendId: string, status: string, party = 1): void {
  sqlite.exec(`
    INSERT INTO event_bookings
      (id, line_account_id, event_id, slot_id, friend_id, status,
       requested_at, identity_key, party_size)
    VALUES ('${id}', 'la1', 'e1', '${slotId}', '${friendId}', '${status}',
      '${new Date().toISOString()}', 'key-${friendId}', ${party});
  `);
}

function addWaiting(id: string, slotId: string, friendId: string, createdAt: string): void {
  sqlite.exec(`
    INSERT INTO event_waitlist
      (id, line_account_id, event_id, slot_id, friend_id, identity_key,
       status, created_at, updated_at)
    VALUES ('${id}', 'la1', 'e1', '${slotId}', '${friendId}', 'key-${friendId}',
      'waiting', '${createdAt}', '${createdAt}');
  `);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '../../../../packages/db/bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = ON');
  db = asD1(sqlite);
});

describe('U 状態の決めごと（純粋関数）', () => {
  test('許す遷移だけを通す', () => {
    expect(canTransitionLifecycle('draft', 'published')).toBe(true);
    expect(canTransitionLifecycle('published', 'paused')).toBe(true);
    expect(canTransitionLifecycle('paused', 'published')).toBe(true);
    expect(canTransitionLifecycle('published', 'ended')).toBe(true);
    expect(canTransitionLifecycle('published', 'cancelled')).toBe(true);
    // 逆戻りと終端からの復帰は止める
    expect(canTransitionLifecycle('published', 'draft')).toBe(false);
    expect(canTransitionLifecycle('paused', 'draft')).toBe(false);
    expect(canTransitionLifecycle('ended', 'published')).toBe(false);
    expect(canTransitionLifecycle('cancelled', 'published')).toBe(false);
  });

  test('一時停止と中止は理由が必須', () => {
    expect(lifecycleReasonRequired('paused')).toBe(true);
    expect(lifecycleReasonRequired('cancelled')).toBe(true);
    expect(lifecycleReasonRequired('published')).toBe(false);
    expect(lifecycleReasonRequired('ended')).toBe(false);
    expect(lifecycleReasonRequired('draft')).toBe(false);
  });

  test('is_published への両書きは公開中だけ 1', () => {
    expect(lifecycleToPublishedFlag('published')).toBe(1);
    expect(lifecycleToPublishedFlag('paused')).toBe(0);
    expect(lifecycleToPublishedFlag('ended')).toBe(0);
    expect(lifecycleToPublishedFlag('cancelled')).toBe(0);
    expect(lifecycleToPublishedFlag('draft')).toBe(0);
  });

  test('状態名の判定', () => {
    expect(isLifecycleStatus('paused')).toBe(true);
    expect(isLifecycleStatus('full')).toBe(false);
    expect(isLifecycleStatus(null)).toBe(false);
    // 「満席」は保存する状態ではない
    expect(isLifecycleStatus('low_applications')).toBe(false);
  });
});

describe('U 変更の事前表示', () => {
  test('定員を確定席より下げると止める', async () => {
    const { eventId, slotId } = seedBase({ published: true, capacity: 2 });
    addBooking('b1', slotId, 'f1', 'confirmed', 2);
    const preview = await previewEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      slotChanges: [{ slot_id: slotId, capacity: 1 }],
    });
    if ('kind' in preview) throw new Error('preview not found');
    expect(preview.blocked).toBe(true);
    expect(preview.impacts[0]?.errors).toContain('slot_capacity_below_bookings');
    expect(preview.total_confirmed).toBe(2);
  });

  test('日時を動かすと知らせる（止めない）', async () => {
    const { eventId, slotId } = seedBase({ published: true, capacity: 4 });
    addBooking('b1', slotId, 'f1', 'confirmed', 1);
    const preview = await previewEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      slotChanges: [{ slot_id: slotId, starts_at: futureIso(8), ends_at: futureIso(8.1) }],
    });
    if ('kind' in preview) throw new Error('preview not found');
    expect(preview.blocked).toBe(false);
    expect(preview.impacts[0]?.notices).toContain('datetime_moved_with_bookings');
  });

  test('別組織のイベントは無いものとして扱う', async () => {
    seedBase({ published: true });
    const preview = await previewEventChange(db, {
      eventId: 'e1',
      lineAccountId: 'la-other',
      slotChanges: [],
    });
    expect(preview).toEqual({ kind: 'not_found' });
  });
});

describe('U 変更確認の適用', () => {
  test('下書きは理由なしで適用でき、版が進み記録が残る', async () => {
    const { eventId, slotId } = seedBase({ published: false, capacity: 4 });
    addBooking('b1', slotId, 'f1', 'confirmed', 1);
    const result = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      actorId: 'staff-1',
      actorRole: 'owner',
      expectedVersion: 1,
      changeReason: null,
      idempotencyKey: 'idem-1',
      slotChanges: [{ slot_id: slotId, capacity: 3 }],
      eventChanges: { venue_name: '店内スペース' },
    });
    if (result.kind !== 'applied') throw new Error(`not applied: ${result.kind}`);
    expect(result.version).toBe(2);
    expect(result.affectedConfirmed).toBe(1);
    const event = sqlite
      .prepare(`SELECT version, venue_name FROM events WHERE id = 'e1'`)
      .get() as { version: number; venue_name: string };
    expect(event.version).toBe(2);
    expect(event.venue_name).toBe('店内スペース');
    const log = sqlite
      .prepare(`SELECT action, reason, actor_id FROM event_change_logs WHERE event_id = 'e1'`)
      .get() as { action: string; reason: string | null; actor_id: string };
    expect(log.action).toBe('change_review_apply');
    expect(log.reason).toBeNull();
    expect(log.actor_id).toBe('staff-1');
  });

  test('公開中は理由が必須', async () => {
    const { eventId, slotId } = seedBase({ published: true, capacity: 4 });
    const result = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      expectedVersion: 1,
      changeReason: '   ',
      idempotencyKey: 'idem-2',
      slotChanges: [{ slot_id: slotId, capacity: 3 }],
    });
    expect(result).toEqual({ kind: 'invalid', error: 'change_reason_required' });
    // 版も記録も進めない
    const event = sqlite.prepare(`SELECT version FROM events WHERE id = 'e1'`).get() as { version: number };
    expect(event.version).toBe(1);
    const logs = sqlite.prepare(`SELECT COUNT(*) AS c FROM event_change_logs`).get() as { c: number };
    expect(logs.c).toBe(0);
  });

  test('版違いは 409 の conflict', async () => {
    const { eventId, slotId } = seedBase({ published: false, capacity: 4 });
    const result = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      expectedVersion: 9,
      changeReason: null,
      idempotencyKey: 'idem-3',
      slotChanges: [{ slot_id: slotId, capacity: 3 }],
    });
    expect(result).toEqual({ kind: 'conflict' });
  });

  test('同じ冪等キーの二重実行は適用しない', async () => {
    const { eventId, slotId } = seedBase({ published: false, capacity: 4 });
    const first = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      expectedVersion: 1,
      changeReason: null,
      idempotencyKey: 'idem-4',
      slotChanges: [{ slot_id: slotId, capacity: 3 }],
    });
    if (first.kind !== 'applied') throw new Error(`not applied: ${first.kind}`);
    const second = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      expectedVersion: 1,
      changeReason: null,
      idempotencyKey: 'idem-4',
      slotChanges: [{ slot_id: slotId, capacity: 3 }],
    });
    expect(second).toEqual({ kind: 'duplicate', logId: first.logId });
    const logs = sqlite.prepare(`SELECT COUNT(*) AS c FROM event_change_logs`).get() as { c: number };
    expect(logs.c).toBe(1);
  });

  test('会場だけの変更は全部の回の確定申込へ知らせる', async () => {
    const { eventId } = seedBase({ published: true, capacity: 4 });
    sqlite.exec(`
      INSERT INTO event_slots (id, event_id, starts_at, ends_at, capacity)
      VALUES ('s2', 'e1', '${futureIso(9)}', '${futureIso(9.1)}', 4);
    `);
    addBooking('b1', 's1', 'f1', 'confirmed', 1);
    addBooking('b2', 's2', 'f2', 'confirmed', 1);
    const result = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      expectedVersion: 1,
      changeReason: '会場が変わりました',
      idempotencyKey: 'idem-venue',
      slotChanges: [],
      eventChanges: { venue_name: '新しい会場' },
    });
    if (result.kind !== 'applied') throw new Error(`not applied: ${result.kind}`);
    expect(result.notifyTargets.map((t) => t.bookingId).sort()).toEqual(['b1', 'b2']);
  });

  test('定員割れの適用は止めて枠を変えない', async () => {
    const { eventId, slotId } = seedBase({ published: false, capacity: 2 });
    addBooking('b1', slotId, 'f1', 'confirmed', 2);
    const before = (sqlite.prepare(`SELECT capacity FROM event_slots WHERE id = 's1'`).get() as { capacity: number }).capacity;
    const result = await applyEventChange(db, {
      eventId,
      lineAccountId: 'la1',
      expectedVersion: 1,
      changeReason: '減らす',
      idempotencyKey: 'idem-5',
      slotChanges: [{ slot_id: slotId, capacity: 1 }],
    });
    expect(result).toEqual({ kind: 'invalid', error: 'slot_capacity_below_bookings' });
    const after = (sqlite.prepare(`SELECT capacity FROM event_slots WHERE id = 's1'`).get() as { capacity: number }).capacity;
    expect(after).toBe(before);
  });
});

describe('U 待ちの順番変更・飛ばし', () => {
  test('順番の変更どおりに並ぶ', async () => {
    const { slotId } = seedBase({ published: true, capacity: 1 });
    addWaiting('w1', slotId, 'f1', '2026-09-01T00:00:00.000Z');
    addWaiting('w2', slotId, 'f2', '2026-09-02T00:00:00.000Z');
    addWaiting('w3', slotId, 'f3', '2026-09-03T00:00:00.000Z');
    const result = await reorderEventWaitlist(db, {
      occurrenceId: slotId,
      lineAccountId: 'la1',
      orderedIds: ['w3', 'w1', 'w2'],
      expectedVersion: 1,
    });
    expect(result.kind).toBe('reordered');
    // 案内の取り出しと同じ順番で読む
    const rows = sqlite
      .prepare(`SELECT id FROM event_waitlist WHERE slot_id = 's1' AND status = 'waiting'
                ORDER BY sort_order ASC, created_at ASC, id ASC`)
      .all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['w3', 'w1', 'w2']);
  });

  test('全件と一致しない並べ直しは止める', async () => {
    const { slotId } = seedBase({ published: true, capacity: 1 });
    addWaiting('w1', slotId, 'f1', '2026-09-01T00:00:00.000Z');
    addWaiting('w2', slotId, 'f2', '2026-09-02T00:00:00.000Z');
    const result = await reorderEventWaitlist(db, {
      occurrenceId: slotId,
      lineAccountId: 'la1',
      orderedIds: ['w2'],
    });
    expect(result).toEqual({ kind: 'invalid', error: 'ordered_ids_mismatch' });
  });

  test('飛ばしは最後尾へ回り、行は残る', async () => {
    const { slotId } = seedBase({ published: true, capacity: 1 });
    addWaiting('w1', slotId, 'f1', '2026-09-01T00:00:00.000Z');
    addWaiting('w2', slotId, 'f2', '2026-09-02T00:00:00.000Z');
    const result = await skipEventWaitlist(db, {
      occurrenceId: slotId,
      waitlistId: 'w1',
      lineAccountId: 'la1',
    });
    expect(result.kind).toBe('skipped');
    const rows = sqlite
      .prepare(`SELECT id, status FROM event_waitlist WHERE slot_id = 's1'
                ORDER BY sort_order ASC, created_at ASC, id ASC`)
      .all() as Array<{ id: string; status: string }>;
    expect(rows.map((r) => r.id)).toEqual(['w2', 'w1']);
    expect(rows.every((r) => r.status === 'waiting')).toBe(true);
  });

  test('案内中の飛ばしは止める', async () => {
    const { slotId } = seedBase({ published: true, capacity: 1 });
    sqlite.exec(`
      INSERT INTO event_waitlist
        (id, line_account_id, event_id, slot_id, friend_id, identity_key,
         status, created_at, updated_at)
      VALUES ('w9', 'la1', 'e1', '${slotId}', 'f1', 'key-f1',
        'offered', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    `);
    const result = await skipEventWaitlist(db, {
      occurrenceId: slotId,
      waitlistId: 'w9',
      lineAccountId: 'la1',
    });
    expect(result).toEqual({ kind: 'invalid', error: 'waitlist_not_waiting' });
  });
});
