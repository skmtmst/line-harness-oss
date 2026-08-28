import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCommonVarMap, getCommonVarUsageImpact } from '../src/common-vars';
import { asD1 } from './d1-test-helper';

describe('common variable usage impact', () => {
  it('counts the exact legacy token across every supported usage kind', async () => {
    const totals = [2, 1, 3, 0, 1, 2, 0];
    const binds: unknown[][] = [];
    const db = {
      prepare: vi.fn((_sql: string) => ({
        bind: (...values: unknown[]) => {
          binds.push(values);
          return { first: async () => ({ total: totals.shift() ?? 0 }) };
        },
      })),
    } as unknown as D1Database;

    const impact = await getCommonVarUsageImpact(db, 'shop_hours');

    expect(impact.total).toBe(9);
    expect(impact.byKind).toMatchObject({
      template: 2,
      broadcast: 1,
      scenario: 3,
      auto_reply: 1,
      form: 2,
    });
    expect(binds.flat()).toHaveLength(12);
    expect(binds.flat().every((value) => value === '{{var.shop_hours}}')).toBe(true);
  });

  it('does not hide a failed scan as zero usages', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: () => ({ first: async () => { throw new Error('table unavailable'); } }),
      })),
    } as unknown as D1Database;

    await expect(getCommonVarUsageImpact(db, 'shop_hours')).rejects.toThrow('table unavailable');
  });
});

describe('common variable account scope', () => {
  it('returns only values assigned to the requested LINE account', async () => {
    const raw = new Database(':memory:');
    raw.exec(readFileSync(join(process.cwd(), 'bootstrap.sql'), 'utf8'));
    raw.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('a1','c1','A1','t','s'), ('a2','c2','A2','t','s');
      INSERT INTO common_vars (id, line_account_id, name, var_key, value)
      VALUES
        ('v1','a1','営業時間','hours','10-18'),
        ('v2','a2','電話番号','phone','000'),
        ('legacy',NULL,'所属不明','legacy_key','hidden');
    `);

    await expect(getCommonVarMap(asD1(raw), 'a1')).resolves.toEqual({ hours: '10-18' });
    await expect(getCommonVarMap(asD1(raw), 'a2')).resolves.toEqual({ phone: '000' });
    await expect(getCommonVarMap(asD1(raw), null)).resolves.toEqual({});
    raw.close();
  });
});
