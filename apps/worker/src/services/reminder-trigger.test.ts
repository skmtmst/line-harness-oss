import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enroll: vi.fn() }));
vi.mock('@line-crm/db', () => ({ enrollFriendInReminder: mocks.enroll }));

import { resolveAnchor, enrollByTrigger, type ReminderTriggerRow } from './reminder-trigger.js';

const RULE: ReminderTriggerRow = {
  id: 'r-1',
  trigger_type: 'booking',
  trigger_offset_minutes: null,
  send_at_time: null,
  target_tag_id: null,
  current_published_version_id: 'version-1',
};

beforeEach(() => {
  mocks.enroll.mockReset().mockResolvedValue({ id: 'enrollment-1' });
});

describe('起点の時刻', () => {
  it('何も設定しなければ開始時刻そのもの', () => {
    expect(resolveAnchor(RULE, '2026-08-20T01:00:00.000Z')).toBe('2026-08-20T01:00:00.000Z');
  });

  it('ずらす分だけ動く', () => {
    // 施術後の追客なら終了時刻の側へ寄せる、といった使い方。
    expect(resolveAnchor({ ...RULE, trigger_offset_minutes: 60 }, '2026-08-20T01:00:00.000Z')).toBe(
      '2026-08-20T02:00:00.000Z',
    );
  });

  it('負のずらしもできる', () => {
    expect(resolveAnchor({ ...RULE, trigger_offset_minutes: -30 }, '2026-08-20T01:00:00.000Z')).toBe(
      '2026-08-20T00:30:00.000Z',
    );
  });

  it('送る時刻を固定すると、予約時刻に左右されなくなる', () => {
    // これが無いと、10時の予約は前日10時、20時の予約は前日20時に届いて、
    // 送る側から何時に届くのか読めない。
    const morning = resolveAnchor({ ...RULE, send_at_time: '18:00' }, '2026-08-20T01:00:00.000Z');
    const evening = resolveAnchor({ ...RULE, send_at_time: '18:00' }, '2026-08-20T11:00:00.000Z');
    // どちらも JST 8/20 18:00 = UTC 09:00
    expect(morning).toBe('2026-08-20T09:00:00.000Z');
    expect(evening).toBe('2026-08-20T09:00:00.000Z');
  });

  it('日付は JST で見る', () => {
    // UTC で日付を切ると、日本の朝9時より前が前日になってしまう。
    // JST 8/20 08:00 の予約 = UTC 8/19 23:00。
    expect(resolveAnchor({ ...RULE, send_at_time: '18:00' }, '2026-08-19T23:00:00.000Z')).toBe(
      '2026-08-20T09:00:00.000Z',
    );
  });

  it('壊れた時刻はずらさずに使う', () => {
    // 設定が読めないからといって送らない、ではリマインダが黙って消える。
    expect(resolveAnchor({ ...RULE, send_at_time: '25:99' }, '2026-08-20T01:00:00.000Z')).toBe(
      '2026-08-20T01:00:00.000Z',
    );
  });

  it('開始時刻が壊れていれば null', () => {
    expect(resolveAnchor(RULE, 'not-a-date')).toBeNull();
  });
});

/** prepare→bind→(first|all|run) を返す最小のモック。 */
function makeDb(handlers: {
  rules?: unknown[];
  tagged?: unknown;
  existing?: unknown;
}) {
  const runs: string[] = [];
  const db = {
    prepare(query: string) {
      return {
        bind() {
          return {
            async all() {
              return { results: handlers.rules ?? [] };
            },
            async first() {
              if (query.includes('friend_tags')) return handlers.tagged ?? null;
              if (query.includes('friend_reminders')) return handlers.existing ?? null;
              return null;
            },
            async run() {
              runs.push(query);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, runs };
}

describe('きっかけによる自動登録', () => {
  it('該当するリマインダが無ければ何もしない', async () => {
    const { db, runs } = makeDb({ rules: [] });
    const n = await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'f-1',
      startsAtIso: '2026-08-20T01:00:00.000Z',
    });
    expect(n).toBe(0);
    expect(runs).toEqual([]);
  });

  it('対象タグが付いていない人は登録しない', async () => {
    const { db, runs } = makeDb({
      rules: [{ ...RULE, target_tag_id: 't-1' }],
      tagged: null,
    });
    const n = await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'f-1',
      startsAtIso: '2026-08-20T01:00:00.000Z',
    });
    expect(n).toBe(0);
    expect(runs).toEqual([]);
  });

  it('対象タグが付いていれば登録する', async () => {
    const { db, runs } = makeDb({
      rules: [{ ...RULE, target_tag_id: 't-1' }],
      tagged: { 1: 1 },
    });
    const n = await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'f-1',
      startsAtIso: '2026-08-20T01:00:00.000Z',
    });
    expect(n).toBe(1);
    expect(runs).toHaveLength(0);
    expect(mocks.enroll).toHaveBeenCalledWith(db, expect.objectContaining({
      reminderId: 'r-1',
      friendId: 'f-1',
      sourceKind: 'booking',
    }));
  });

  it('同じ起点で既に登録済みなら増やさない', async () => {
    // 予約の状態が何度か変わっても、そのたびに登録が増えないように。
    const { db, runs } = makeDb({ rules: [RULE], existing: { 1: 1 } });
    const n = await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'f-1',
      startsAtIso: '2026-08-20T01:00:00.000Z',
    });
    expect(n).toBe(0);
    expect(runs).toEqual([]);
  });

  it('開始時刻が壊れていても落ちない', async () => {
    const { db } = makeDb({ rules: [RULE] });
    const n = await enrollByTrigger(db, {
      triggerType: 'booking',
      friendId: 'f-1',
      startsAtIso: 'garbage',
    });
    expect(n).toBe(0);
  });
});
