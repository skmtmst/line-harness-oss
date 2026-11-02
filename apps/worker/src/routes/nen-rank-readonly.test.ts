import { describe, expect, it } from 'vitest';
import { buildMembership, loadRankSetup } from './nen-members-definition.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { ensureNenRankDefaults } from '@line-crm/db';

describe('rank read without configuration', () => {
  it('does not create settings and does not infer a rank', async () => {
    const { db, raw } = createTestD1();
    const setup = await loadRankSetup(db, 'fresh');
    expect(setup.ranks).toEqual([]);
    const membership = await buildMembership(db, 'fresh', { annual_miles_yen: 150000, member_rank: '会員', member_rank_key: null });
    expect(membership.rankName).toBe('未設定');
    expect(membership.rankKey).toBeNull();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM nen_rank_settings').get()).toEqual({ n: 0 });
    raw.close();
  });
  it('uses the configured name for a matching key instead of the computed snapshot name', async () => {
    const { db, raw } = createTestD1();
    await ensureNenRankDefaults(db, 'fresh');
    const membership = await buildMembership(db, 'fresh', { member_rank_key: 'platinum', member_rank: 'シルバー会員' });
    expect(membership.rankName).toBe('プラチナ');
    raw.close();
  });
  it('uses only a separately recorded EC name for an unknown key', async () => {
    const { db, raw } = createTestD1();
    await ensureNenRankDefaults(db, 'fresh');
    const snapshot = { member_rank_key: 'vip', member_rank: 'ゴールド会員', ec_member_rank_name: 'VIP' };
    expect((await buildMembership(db, 'fresh', snapshot)).rankName).toBe('VIP');
    expect((await buildMembership(db, 'fresh', { ...snapshot, ec_member_rank_name: null })).rankName).toBe('未設定');
    expect((await buildMembership(db, 'fresh', { ...snapshot, member_rank_key: null })).rankName).toBe('未設定');
    raw.close();
  });
  it('reports rank lookup failure instead of presenting an unconfigured store', async () => {
    await expect(buildMembership({} as D1Database, 'fresh', { member_rank: '会員', member_rank_key: null })).rejects.toThrow();
  });
  it('reports partial milestone lookup failure without changing ranks', async () => {
    const { db, raw } = createTestD1();
    await ensureNenRankDefaults(db, 'fresh');
    const partial = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes('FROM nen_lifetime_milestones')) throw new Error('injected read error');
        return target.prepare(sql);
      };
      return Reflect.get(target, key);
    } });
    await expect(buildMembership(partial, 'fresh', { member_rank_key: null, member_rank: '会員' })).rejects.toThrow('injected read error');
    raw.close();
  });


});
