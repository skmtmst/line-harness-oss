import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { createTrafficPool, getRandomPoolAccount } from '../src/traffic-pools.js';
function setup() {
  const raw = new Database(':memory:');
  raw.exec(readFileSync('bootstrap.sql', 'utf8')); raw.pragma('foreign_keys = ON');
  for (const id of ['a','b']) raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES (?, ?, ?, 'token', 'secret')`).run(id,id,id);
  return { raw, db: asD1(raw) };
}
describe('atomic pool creation', () => {
  it('includes all accounts in random distribution immediately', async () => {
    const {raw,db} = setup();
    const pool = await createTrafficPool(db, {name:'Area',slug:'area',activeAccountId:'a',accountIds:['a','b','a']});
    expect(raw.prepare('SELECT line_account_id FROM pool_accounts WHERE pool_id = ? ORDER BY line_account_id').all(pool.id)).toEqual([{line_account_id:'a'},{line_account_id:'b'}]);
    expect(['a','b']).toContain((await getRandomPoolAccount(db,pool.id))?.line_account_id);
  });
  it('rolls back the pool when membership fails', async () => {
    const {raw,db} = setup();
    await expect(createTrafficPool(db,{name:'Area',slug:'area',activeAccountId:'a',accountIds:['a','missing']})).rejects.toThrow();
    expect(raw.prepare('SELECT count(*) AS n FROM traffic_pools WHERE slug = ?').get('area')).toEqual({n:0});
  });
});
