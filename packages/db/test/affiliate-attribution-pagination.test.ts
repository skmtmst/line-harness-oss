import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explainAffiliateAttribution } from '../src/affiliate-attribution.js';
import { asD1 } from './d1-test-helper.js';

const NOW = '2026-10-08T03:00:00.000Z';
describe('last eligible attribution paged search (PKG41)', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account', 'channel', 'account', 'token', 'secret');
      INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('friend', 'U-friend', 'account');
      INSERT INTO affiliates (id, name, code, line_account_id) VALUES ('eligible', 'eligible', 'eligible', 'account');
      INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, is_active, created_at)
        VALUES ('off-link', 'eligible', 'OFF', 'account', 0, '2026-01-01'),
               ('on-link', 'eligible', 'ON', 'account', 1, '2026-01-01');`);
    db = asD1(sqlite);
  });
  afterEach(() => sqlite.close());
  function touch(id: string, ref: string, at: string) {
    sqlite.prepare('INSERT INTO ref_tracking (id, friend_id, ref_code, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'friend', ref, at);
  }

  it('finds a valid older touch past more than one page of inactive links', async () => {
    for (let i = 0; i < 120; i++) touch(`off-${i}`, 'OFF', '2026-10-07T03:00:00.000Z');
    touch('winner', 'ON', '2026-10-06T03:00:00.000Z');
    const result = await explainAffiliateAttribution(db, 'friend', NOW, { lineAccountId: 'account' });
    expect(result.decision).toMatchObject({ affiliateId: 'eligible', refCode: 'ON' });
    expect(result.reason).toBe('matched_last_touch');
    expect(result.candidates.filter((c) => c.chosen)).toHaveLength(1);
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates.filter((c) => c.skipReason === 'inactive_link')).toHaveLength(19);
  });

  it('continues past tied timestamps using a stable key and does not repeat touches', async () => {
    for (let i = 0; i < 120; i++) touch(`z-${String(i).padStart(3, '0')}`, 'OFF', '2026-10-07T03:00:00.000Z');
    touch('a-winner', 'ON', '2026-10-07T03:00:00.000Z');
    const result = await explainAffiliateAttribution(db, 'friend', NOW, { lineAccountId: 'account' });
    expect(result.decision?.refCode).toBe('ON');
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates.filter((c) => c.chosen)).toHaveLength(1);
  });

  it('still rejects out-of-window older touches and future touches', async () => {
    for (let i = 0; i < 25; i++) touch(`off-${i}`, 'OFF', '2026-10-07T03:00:00.000Z');
    touch('expired', 'ON', '2026-01-01T03:00:00.000Z');
    touch('future', 'ON', '2026-10-09T03:00:00.000Z');
    const result = await explainAffiliateAttribution(db, 'friend', NOW, { lineAccountId: 'account' });
    expect(result.decision).toBeNull();
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates.some((c) => c.chosen)).toBe(false);
    expect(result.candidates.some((c) => c.touchedAt === '2026-10-09T03:00:00.000Z')).toBe(false);
  });

  it('paginates the legacy minimal schema fallback as well', async () => {
    const legacy = new Database(':memory:');
    try {
      legacy.exec(`CREATE TABLE affiliates (id TEXT PRIMARY KEY, is_active INTEGER, friend_id TEXT);
        CREATE TABLE affiliate_links (id TEXT PRIMARY KEY, affiliate_id TEXT, ref_code TEXT, is_active INTEGER);
        CREATE TABLE ref_tracking (id TEXT PRIMARY KEY, friend_id TEXT, ref_code TEXT, created_at TEXT);
        INSERT INTO affiliates VALUES ('affiliate', 1, NULL);
        INSERT INTO affiliate_links VALUES ('off', 'affiliate', 'OFF', 0), ('on', 'affiliate', 'ON', 1);`);
      const insert = legacy.prepare("INSERT INTO ref_tracking VALUES (?, 'friend', ?, ?)");
      for (let i = 0; i < 120; i++) insert.run(`off-${i}`, 'OFF', '2026-10-07T03:00:00.000Z');
      insert.run('winner', 'ON', '2026-10-06T03:00:00.000Z');
      const result = await explainAffiliateAttribution(asD1(legacy), 'friend', NOW);
      expect(result.decision).toMatchObject({ affiliateId: 'affiliate', refCode: 'ON' });
      expect(result.candidates).toHaveLength(20);
      expect(result.candidates.filter((c) => c.chosen)).toHaveLength(1);
    } finally { legacy.close(); }
  });
});
