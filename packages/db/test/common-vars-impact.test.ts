import { describe, expect, it, vi } from 'vitest';
import { getCommonVarUsageImpact } from '../src/common-vars';

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
