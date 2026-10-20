import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '266_nen_enable_shared_friend_add_coupon.sql'),
  'utf8',
);

function setting(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    isEnabled: true,
    codePrefix: 'NENLINE',
    discountRate: 5,
    validityDays: 31,
    couponName: 'LINE友だち追加 5%OFF',
    ...overrides,
  });
}

describe('migration 266 NEN shared friend-add coupon setting', () => {
  it('updates only the matching enabled legacy setting and preserves unrelated fields', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE account_settings (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT 'now',
        updated_at TEXT NOT NULL DEFAULT 'now',
        UNIQUE(line_account_id, key)
      );
    `);
    const insert = db.prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?, ?, ?, ?)`,
    );
    insert.run('target', 'nen-staging', 'nen.friend_add_coupon', setting({ keepMe: 'preserved' }));
    insert.run('disabled', 'disabled-account', 'nen.friend_add_coupon', setting({ isEnabled: false }));
    insert.run('different', 'other-account', 'nen.friend_add_coupon', setting({ codePrefix: 'OTHER' }));
    insert.run('unrelated', 'nen-staging', 'another.setting', setting());

    db.exec(migration);

    const target = JSON.parse(db.prepare(`SELECT value FROM account_settings WHERE id = 'target'`).pluck().get() as string);
    expect(target).toMatchObject({
      isEnabled: true,
      deliveryMode: 'shared',
      sharedCouponCode: 'LINEREG5',
      sharedValidTo: '2026-12-31',
      discountRate: 5,
      keepMe: 'preserved',
    });
    expect(target.messageTemplate).toContain('クーポンコード：{coupon_code}');
    expect(target.messageTemplate).toContain('有効期限：{expires_on}まで');
    expect(target.messageTemplate).toContain('お買い物金額に応じてポイントが貯まります');
    expect(target.messageTemplate).toContain('※お一人様1回限りです。');

    expect(db.prepare(`SELECT value FROM account_settings WHERE id = 'disabled'`).pluck().get())
      .toBe(setting({ isEnabled: false }));
    expect(db.prepare(`SELECT value FROM account_settings WHERE id = 'different'`).pluck().get())
      .toBe(setting({ codePrefix: 'OTHER' }));
    expect(db.prepare(`SELECT value FROM account_settings WHERE id = 'unrelated'`).pluck().get())
      .toBe(setting());
  });
});
