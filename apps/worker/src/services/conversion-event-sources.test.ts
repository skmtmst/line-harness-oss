import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trackConversion: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  trackConversion: mocks.trackConversion,
}));

const { recordConversionSourceEvent, CONVERSION_SOURCE_TYPES } = await import(
  './conversion-event-sources.js'
);

interface FriendRow {
  id: string;
  line_account_id: string | null;
}

interface PointRow {
  id: string;
  event_type: string;
  status: string;
  line_account_id: string | null;
}

/** friends と conversion_points の2口だけを賄う最小D1。 */
function makeDb(state: { friends: FriendRow[]; points: PointRow[] }): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM friends')) {
            const [id] = bound as [string];
            const row = state.friends.find((f) => f.id === id);
            return (row ? { line_account_id: row.line_account_id } : null) as T | null;
          }
          return null as T | null;
        },
        async all<T>() {
          if (sql.includes('FROM conversion_points')) {
            const [eventType, accountId] = bound as [string, string];
            const results = state.points.filter(
              (p) =>
                p.event_type === eventType &&
                p.status === 'active' &&
                (p.line_account_id === null || p.line_account_id === accountId),
            );
            return { results: results as T[] };
          }
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

const friend = { id: 'friend-1', line_account_id: 'account-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trackConversion.mockResolvedValue({ id: 'event-1' });
});

describe('コンバージョン起点の実イベント接続', () => {
  it('画面の6起点すべてが一致する地点に記録される', async () => {
    expect(CONVERSION_SOURCE_TYPES).toHaveLength(6);
    for (const sourceType of CONVERSION_SOURCE_TYPES) {
      vi.clearAllMocks();
      const db = makeDb({
        friends: [friend],
        points: [{ id: `point-${sourceType}`, event_type: sourceType, status: 'active', line_account_id: 'account-1' }],
      });
      const result = await recordConversionSourceEvent(db, {
        sourceType,
        lineAccountId: 'account-1',
        friendId: 'friend-1',
        sourceEventId: 'src-1',
      });
      expect(result).toEqual({ matched: 1, recorded: 1, failed: 0, skipped: null });
      expect(mocks.trackConversion).toHaveBeenCalledTimes(1);
      expect(mocks.trackConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        conversionPointId: `point-${sourceType}`,
        friendId: 'friend-1',
      }));
    }
  });

  it('ほかのアカウントの地点は数えず全店共通の地点は拾う', async () => {
    const db = makeDb({
      friends: [friend],
      points: [
        { id: 'point-other', event_type: 'form_submitted', status: 'active', line_account_id: 'account-9' },
        { id: 'point-common', event_type: 'form_submitted', status: 'active', line_account_id: null },
        { id: 'point-mine', event_type: 'form_submitted', status: 'active', line_account_id: 'account-1' },
      ],
    });
    const result = await recordConversionSourceEvent(db, {
      sourceType: 'form_submitted',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'sub-1',
    });
    expect(result.matched).toBe(2);
    const ids = mocks.trackConversion.mock.calls.map((call) => (call[1] as { conversionPointId: string }).conversionPointId);
    expect(ids.sort()).toEqual(['point-common', 'point-mine']);
  });

  it('申告アカウントと友だちの所属が違えば数えない', async () => {
    const db = makeDb({
      friends: [friend],
      points: [{ id: 'point-1', event_type: 'tag_added', status: 'active', line_account_id: 'account-1' }],
    });
    const result = await recordConversionSourceEvent(db, {
      sourceType: 'tag_added',
      lineAccountId: 'account-9',
      friendId: 'friend-1',
      sourceEventId: 'tag-1',
    });
    expect(result.skipped).toBe('account_mismatch');
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });

  it('同じ元イベントの再送は同じ冪等キーで渡す', async () => {
    const db = makeDb({
      friends: [friend],
      points: [{ id: 'point-1', event_type: 'ec_order_confirmed', status: 'active', line_account_id: 'account-1' }],
    });
    const input = {
      sourceType: 'ec_order_confirmed',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'eccube-evt-1',
    };
    await recordConversionSourceEvent(db, input);
    await recordConversionSourceEvent(db, input);
    expect(mocks.trackConversion).toHaveBeenCalledTimes(2);
    const keys = mocks.trackConversion.mock.calls.map(
      (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain('eccube-evt-1');
  });

  it('未対応の起点は成功扱いで捨てず記録だけ残す', async () => {
    const db = makeDb({
      friends: [friend],
      points: [{ id: 'point-1', event_type: 'form_submitted', status: 'active', line_account_id: 'account-1' }],
    });
    const result = await recordConversionSourceEvent(db, {
      sourceType: 'mystery_future_event',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'x-1',
    });
    expect(result.skipped).toBe('unknown_source');
    expect(result.matched).toBe(0);
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });

  it('停止中の地点は数えない', async () => {
    const db = makeDb({
      friends: [friend],
      points: [{ id: 'point-1', event_type: 'reservation_confirmed', status: 'stopped', line_account_id: 'account-1' }],
    });
    const result = await recordConversionSourceEvent(db, {
      sourceType: 'reservation_confirmed',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'booking-1',
    });
    expect(result.matched).toBe(0);
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });

  it('知らない友だちのイベントは数えない', async () => {
    const db = makeDb({ friends: [], points: [] });
    const result = await recordConversionSourceEvent(db, {
      sourceType: 'webinar_completed',
      lineAccountId: 'account-1',
      friendId: 'ghost',
      sourceEventId: 'w-1',
    });
    expect(result.skipped).toBe('friend_not_found');
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });
});
