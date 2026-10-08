import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('616 backfills positive rates as rate and zero as fixed without touching approvals', () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(`CREATE TABLE affiliates(id TEXT, commission_rate REAL);
      INSERT INTO affiliates VALUES ('rate',10), ('fixed',0);
      CREATE TABLE conversion_events(id TEXT, approval_amount_minor INTEGER);
      INSERT INTO conversion_events VALUES ('approved',1234);`);
    raw.exec(readFileSync(new URL('../migrations/616_affiliate_reward_mode.sql', import.meta.url), 'utf8'));
    expect(raw.prepare('SELECT id,reward_mode FROM affiliates ORDER BY id').all()).toEqual([
      { id: 'fixed', reward_mode: 'fixed' }, { id: 'rate', reward_mode: 'rate' },
    ]);
    expect(raw.prepare('SELECT * FROM conversion_events').all()).toEqual([{ id: 'approved', approval_amount_minor: 1234 }]);
    expect(() => raw.exec("UPDATE affiliates SET reward_mode = 'invalid'")).toThrow();
  } finally { raw.close(); }
});
