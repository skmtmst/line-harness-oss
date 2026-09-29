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
const sharedCouponMigration = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations', '265_nen_shared_friend_add_coupon.sql'),
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

/** 4xx は実行されていない。通信断・429・5xx は実行されたかもしれない。 */
function classifyByStatus(error: unknown): 'failed' | 'unknown' {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429
    ? 'failed'
    : 'unknown';
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
    sqlite.exec(sharedCouponMigration);
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

  /*
   * N-101(#622): 送ったか分からない送信を `failed_send` にすると、次の
   * 友だち追加で送り直す。届いていた人へ2通目のクーポン案内が出るので、
   * 送った可能性がある側へ倒して人の確認に回す。
   */
  /*
   * N-101(#622): 作れたか分からない作成呼び出しを `failed_create` にすると、
   * 次の友だち追加で同じコードの作成をもう一度投げ、EC側に二重に作られる。
   */
  it('作成の通信断は作り直さない（作られた可能性がある側へ倒す）', async () => {
    sqlite.prepare(`INSERT INTO friends (id) VALUES ('friend-create-unknown')`).run();
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => {
      throw new Error('network timeout');
    });
    const sendText = vi.fn(async (_text: string) => undefined);
    const input = {
      lineAccountId: 'nen-account', friendId: 'friend-create-unknown',
      now: new Date('2026-09-02T02:00:00.000Z'),
    };

    await expect(issueFriendAddCoupon(db, input, {
      createCoupon, sendText, classifySendFailure: classifyByStatus,
    })).rejects.toThrow('friend_add_coupon_create_unknown');
    expect(sqlite.prepare(
      `SELECT status, last_error FROM nen_friend_add_coupon_issues WHERE friend_id = 'friend-create-unknown'`,
    ).get()).toEqual({ status: 'coupon_created', last_error: 'coupon_create_unknown' });
    // この実行では送らない（コードが実在するか確かめられていない）
    expect(sendText).not.toHaveBeenCalled();

    // 次の友だち追加でも作成APIを投げ直さない
    const retryCreate = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const retrySend = vi.fn(async (_text: string) => undefined);
    await expect(issueFriendAddCoupon(db, input, {
      createCoupon: retryCreate, sendText: retrySend, classifySendFailure: classifyByStatus,
    })).resolves.toBe('sent');
    expect(retryCreate).not.toHaveBeenCalled();
    expect(retrySend).toHaveBeenCalledTimes(1);
  });

  it('ECが断った作成（4xx）は従来どおり作り直せる', async () => {
    sqlite.prepare(`INSERT INTO friends (id) VALUES ('friend-create-rejected')`).run();
    const rejected = Object.assign(new Error('EC error: 400'), { status: 400 });
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => { throw rejected; });
    const sendText = vi.fn(async (_text: string) => undefined);
    const input = {
      lineAccountId: 'nen-account', friendId: 'friend-create-rejected',
      now: new Date('2026-09-02T02:00:00.000Z'),
    };

    await expect(issueFriendAddCoupon(db, input, {
      createCoupon, sendText, classifySendFailure: classifyByStatus,
    })).rejects.toThrow('friend_add_coupon_create_failed');
    expect(sqlite.prepare(
      `SELECT status FROM nen_friend_add_coupon_issues WHERE friend_id = 'friend-create-rejected'`,
    ).get()).toEqual({ status: 'failed_create' });

    const retryCreate = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    await expect(issueFriendAddCoupon(db, input, {
      createCoupon: retryCreate, sendText, classifySendFailure: classifyByStatus,
    })).resolves.toBe('sent');
    expect(retryCreate).toHaveBeenCalledTimes(1);
  });

  it('通信断のように結末が分からない送信は送り直さない（送達不明）', async () => {
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const sendText = vi.fn(async (_text: string) => { throw new Error('network timeout'); });
    sqlite.prepare(`INSERT INTO friends (id) VALUES ('friend-unknown')`).run();
    const input = {
      lineAccountId: 'nen-account', friendId: 'friend-unknown',
      now: new Date('2026-09-02T02:00:00.000Z'),
    };

    await expect(issueFriendAddCoupon(db, input, { createCoupon, sendText, classifySendFailure: classifyByStatus }))
      .rejects.toThrow('friend_add_coupon_send_unknown');
    expect(sqlite.prepare(
      `SELECT status, last_error FROM nen_friend_add_coupon_issues WHERE friend_id = 'friend-unknown'`,
    ).get()).toEqual({ status: 'sent', last_error: 'line_send_unknown' });

    // 次の友だち追加では送り直さない
    const retrySend = vi.fn(async (_text: string) => undefined);
    await expect(issueFriendAddCoupon(db, input, {
      createCoupon, sendText: retrySend, classifySendFailure: classifyByStatus,
    })).resolves.toBe('already_sent');
    expect(retrySend).not.toHaveBeenCalled();
  });

  it('LINEが断った送信（4xx）は従来どおり送り直せる', async () => {
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const rejected = Object.assign(new Error('LINE API error: 400'), { status: 400 });
    const sendText = vi.fn(async (_text: string) => { throw rejected; });
    sqlite.prepare(`INSERT INTO friends (id) VALUES ('friend-rejected')`).run();
    const input = {
      lineAccountId: 'nen-account', friendId: 'friend-rejected',
      now: new Date('2026-09-02T02:00:00.000Z'),
    };

    await expect(issueFriendAddCoupon(db, input, { createCoupon, sendText, classifySendFailure: classifyByStatus }))
      .rejects.toThrow('friend_add_coupon_send_failed');
    expect(sqlite.prepare(
      `SELECT status FROM nen_friend_add_coupon_issues WHERE friend_id = 'friend-rejected'`,
    ).get()).toEqual({ status: 'failed_send' });

    const retrySend = vi.fn(async (_text: string) => undefined);
    await expect(issueFriendAddCoupon(db, input, {
      createCoupon, sendText: retrySend, classifySendFailure: classifyByStatus,
    })).resolves.toBe('sent');
    expect(retrySend).toHaveBeenCalledTimes(1);
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

  it('sends an existing EC-CUBE coupon without creating another coupon', async () => {
    sqlite.prepare(`UPDATE account_settings SET value = ? WHERE line_account_id = ? AND key = ?`).run(
      JSON.stringify({
        isEnabled: true,
        deliveryMode: 'shared',
        sharedCouponCode: 'LINEREG5',
        sharedValidTo: '2026-12-31',
        discountRate: 5,
        messageTemplate: [
          'クーポンコード：{coupon_code}',
          '有効期限：{expires_on}まで',
          '割引：{discount_rate}%OFF',
        ].join('\n'),
      }),
      'nen-account',
      FRIEND_ADD_COUPON_SETTING_KEY,
    );
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const sendText = vi.fn(async (_text: string) => undefined);

    await expect(issueFriendAddCoupon(db, {
      lineAccountId: 'nen-account',
      friendId: 'friend-a',
      now: new Date('2026-09-03T02:00:00.000Z'),
    }, { createCoupon, sendText })).resolves.toBe('sent');

    expect(createCoupon).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith([
      'クーポンコード：LINEREG5',
      '有効期限：2026年12月31日まで',
      '割引：5%OFF',
    ].join('\n'));
  });

  it('allows the same shared coupon code to be recorded for different friends', async () => {
    sqlite.prepare(`INSERT INTO friends (id) VALUES ('friend-b')`).run();
    sqlite.prepare(`UPDATE account_settings SET value = ? WHERE line_account_id = ? AND key = ?`).run(
      JSON.stringify({
        isEnabled: true,
        deliveryMode: 'shared',
        sharedCouponCode: 'LINEREG5',
        sharedValidTo: '2026-12-31',
        discountRate: 5,
        messageTemplate: 'コード：{coupon_code}\n期限：{expires_on}',
      }),
      'nen-account',
      FRIEND_ADD_COUPON_SETTING_KEY,
    );
    const createCoupon = vi.fn(async (_coupon: EccubeCouponInput) => undefined);
    const sendText = vi.fn(async (_text: string) => undefined);

    await issueFriendAddCoupon(db, {
      lineAccountId: 'nen-account', friendId: 'friend-a', now: new Date('2026-09-03T02:00:00.000Z'),
    }, { createCoupon, sendText });
    await issueFriendAddCoupon(db, {
      lineAccountId: 'nen-account', friendId: 'friend-b', now: new Date('2026-09-03T02:00:00.000Z'),
    }, { createCoupon, sendText });

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM nen_friend_add_coupon_issues WHERE coupon_code = 'LINEREG5'`).get())
      .toEqual({ count: 2 });
  });

  it('includes coupon expiry and the point program in the default greeting', () => {
    const message = buildFriendAddCouponMessage({
      code: 'LINEREG5', discountRate: 5, expiresAt: '2026-12-31T23:59:59+09:00',
    });
    expect(message).toContain('有効期限：2026年12月31日まで');
    expect(message).toContain('お買い物金額に応じてポイントが貯まります');
    expect(message).toContain('ポイントで受け取れる特典をLINEで順次ご案内します');
    expect(message).toContain('※お一人様1回限りです。');
  });
});
