import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EccubeCouponInput } from './eccube-coupon.js';
import {
  FRIEND_ADD_COUPON_SETTING_KEY,
  buildFriendAddCouponMessage,
  issueFriendAddCoupon,
} from './friend-add-coupon.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations', '264_nen_friend_add_coupons.sql'),
  'utf8',
);

function asTestD1(sqlite: Database.Database): D1Database {
  const prepare = (query: string): D1PreparedStatement => {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...values: unknown[]) => bound(values),
      all: async <T>() => ({ results: statement.all(...params) as T[], success: true, meta: {} }),
      first: async <T>() => (statement.get(...params) as T | undefined) ?? null,
      run: async <T>() => ({ success: true, meta: { changes: statement.run(...params).changes }, results: [] }) as T,
      raw: async () => [],
    }) as unknown as D1PreparedStatement;
    return bound([]);
  };
  return { prepare } as unknown as D1Database;
}

describe('NEN friend-add coupon', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      CREATE TABLE account_settings (
        id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        created_at TEXT, updated_at TEXT, UNIQUE(line_account_id, key)
      );
      INSERT INTO line_accounts (id) VALUES ('nen-account');
      INSERT INTO friends (id) VALUES ('friend-a');
    `);
    sqlite.exec(migration);
    sqlite.prepare(`INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?, ?, ?, ?)`).run(
      'setting-a',
      'nen-account',
      FRIEND_ADD_COUPON_SETTING_KEY,
      JSON.stringify({
        isEnabled: true,
        codePrefix: 'NENLINE',
        discountRate: 5,
        validityDays: 31,
        couponName: 'LINE友だち追加 5%OFF',
      }),
    );
    db = asTestD1(sqlite);
  });

  it('creates and sends one unique 5% coupon for the friend', async () => {
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const sendText = vi.fn(async (_text: string) => undefined);

    await expect(issueFriendAddCoupon(db, {
      lineAccountId: 'nen-account',
      friendId: 'friend-a',
      now: new Date('2026-09-02T02:00:00.000Z'),
    }, { createCoupon, sendText })).resolves.toBe('sent');

    expect(createCoupon).toHaveBeenCalledWith(expect.objectContaining({
      code: expect.stringMatching(/^NENLINE-[A-F0-9]{12}$/),
      discountType: 'rate',
      discountRate: 5,
      memberOnly: false,
      validFrom: '2026-09-02T11:00:00+09:00',
      validTo: '2026-10-03T11:00:00+09:00',
    }));
    expect(sendText.mock.calls[0]?.[0]).toContain('5%OFF');
    expect(sendText.mock.calls[0]?.[0]).toContain('お一人様1回限り');
  });

  it('does not issue or send a second coupon to the same friend', async () => {
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const sendText = vi.fn(async (_text: string) => undefined);
    const input = { lineAccountId: 'nen-account', friendId: 'friend-a', now: new Date('2026-09-02T02:00:00.000Z') };

    await issueFriendAddCoupon(db, input, { createCoupon, sendText });
    await expect(issueFriendAddCoupon(db, input, { createCoupon, sendText })).resolves.toBe('already_sent');
    expect(createCoupon).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('keeps one common campaign while rendering a different code per friend', () => {
    const first = buildFriendAddCouponMessage({ code: 'NENLINE-AAAA1111', discountRate: 5, expiresAt: '2026-10-03' });
    const second = buildFriendAddCouponMessage({ code: 'NENLINE-BBBB2222', discountRate: 5, expiresAt: '2026-10-03' });
    expect(first).toContain('NENLINE-AAAA1111');
    expect(second).toContain('NENLINE-BBBB2222');
    expect(first).toContain('5%OFF');
    expect(second).toContain('5%OFF');
  });
});
