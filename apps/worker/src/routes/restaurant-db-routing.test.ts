import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Env } from '../index.js';
import { dbFor } from '../services/db-router.js';

const here = dirname(fileURLToPath(import.meta.url));
const restaurantSources = [
  join(here, 'restaurant-test.ts'),
  join(here, '../services/restaurant-test.ts'),
];

describe('飲食店向けD1ルーティング境界', () => {
  it('単一DB構成では店舗IDの有無にかかわらず既存DBを返す', () => {
    const db = {} as D1Database;
    const env = { DB: db } as Env['Bindings'];

    expect(dbFor(env)).toBe(db);
    expect(dbFor(env, 'store-1')).toBe(db);
    expect(dbFor(env, null)).toBe(db);
  });

  it('飲食店向けコードはD1を直接参照しない', () => {
    for (const path of restaurantSources) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/\b(?:c\.)?env\.DB\b/);
    }
  });
});
