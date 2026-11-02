import { describe, expect, it } from 'vitest';
import { buildMembership, loadRankSetup } from './nen-members-definition.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { ensureNenRankDefaults } from '@line-crm/db';

describe('rank read without configuration', () => {
  it('does not create settings and does not infer a rank', async () => {
    const { db, raw } = createTestD1();
    const setup = await loadRankSetup(db, 'fresh');
    expect(setup.ranks).toEqual([]);
    const membership = await buildMembership(db, 'fresh', { annual_miles_yen: 150000, member_rank: null, member_rank_key: null });
    expect(membership.rankName).toBe('未設定');
    expect(membership.rankKey).toBeNull();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM nen_rank_settings').get()).toEqual({ n: 0 });
    raw.close();
  });
  it('does not invent a rank when the lookup fails', async () => {
    const membership = await buildMembership({} as D1Database, 'fresh', { member_rank: null, member_rank_key: null });
    expect(membership.rankName).toBe('未設定');
    expect(membership.rankKey).toBeNull();
    expect(membership.ranks).toEqual([]);
  });
  it('a failed milestone read does not invent a rank or mutate configured rows', async () => {
    const { db, raw } = createTestD1();
    await ensureNenRankDefaults(db, 'fresh');
    const before = raw.prepare('SELECT * FROM nen_rank_settings WHERE line_account_id = ? ORDER BY rank_key').all('fresh');
    const partial = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes('FROM nen_lifetime_milestones')) throw new Error('injected read error');
        return target.prepare(sql);
      };
      return Reflect.get(target, key);
    } });
    const membership = await buildMembership(partial, 'fresh', { member_rank_key: null, member_rank: null, annual_miles_yen: 120000 });
    expect(membership).toMatchObject({ rankName: '未設定', rankKey: null, rankPositionKnown: false, next: null });
    expect(raw.prepare('SELECT * FROM nen_rank_settings WHERE line_account_id = ? ORDER BY rank_key').all('fresh')).toEqual(before);
    raw.close();
  });

});
