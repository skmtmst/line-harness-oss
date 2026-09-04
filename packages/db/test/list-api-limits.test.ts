import { describe, expect, test, vi } from 'vitest';
import { getFriends } from '../src/friends.js';
import { getAutomationLogs } from '../src/automations.js';
import { getStripeEvents } from '../src/stripe.js';
import { getAdConversionLogs } from '../src/ad-platforms.js';
import { getConversionEvents } from '../src/conversions.js';
import { getConversionApprovalQueue } from '../src/affiliate-report.js';
import { getChats } from '../src/chats.js';

function recordingDb() {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[] };
      calls.push(call);
      const statement = {
        bind(...bindings: unknown[]) { call.bindings = bindings; return statement; },
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => ({ total: 0 })),
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('DB一覧helperの200件上限', () => {
  test('巨大なlimitを200へ丸める', async () => {
    const { db, calls } = recordingDb();
    const scope = { allowedAccountIds: [] as string[], includeUnassigned: true };

    await getFriends(db, { limit: 999999, offset: -1 });
    await getChats(db, { limit: 999999, offset: -1 });
    await getAutomationLogs(db, 'automation-1', 999999);
    await getStripeEvents(db, { limit: 999999 });
    await getAdConversionLogs(db, 'platform-1', 999999);
    await getConversionEvents(db, { scope, limit: 999999, offset: -1 });
    await getConversionApprovalQueue(db, {
      scope,
      status: 'pending',
      identityKeySql: 'friends.id',
      limit: 999999,
      offset: -1,
    });

    expect(calls[0].bindings.slice(-2)).toEqual([200, 0]);
    expect(calls[1].bindings.slice(-2)).toEqual([200, 0]);
    expect(calls[2].bindings.at(-1)).toBe(200);
    expect(calls[3].bindings.at(-1)).toBe(200);
    expect(calls[4].bindings.at(-1)).toBe(200);
    expect(calls[5].bindings.slice(-2)).toEqual([200, 0]);
    expect(calls[6].bindings.slice(-2)).toEqual([200, 0]);
  });

  test('負数とNaNを既定値へ戻し、LIMIT -1を作らない', async () => {
    const { db, calls } = recordingDb();
    await getFriends(db, { limit: -1, offset: Number.NaN });
    await getAutomationLogs(db, undefined, Number.NaN);
    await getStripeEvents(db, { limit: -1 });
    await getAdConversionLogs(db, 'platform-1', Number.NaN);

    expect(calls.map(({ bindings }) => bindings.at(-1))).toEqual([0, 100, 100, 50]);
    expect(calls.flatMap(({ bindings }) => bindings)).not.toContain(-1);
  });
});
