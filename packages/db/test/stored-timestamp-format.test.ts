import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { storedTimestamp } from '../../shared/src/line-observation-time.js';

it('SQLも空白UTC・時差なしTのJST・明示時差を同じ瞬間に変換する', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE t (at TEXT); INSERT INTO t VALUES
    ('2026-11-04 10:00:00'), ('2026-11-04T19:00:00.000'), ('2026-11-04T12:00:00+02:00');`);
  const rows = db.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%SZ', ${storedTimestamp('at', 'sql')}) AS instant FROM t`).all();
  expect(rows).toEqual(Array.from({ length: 3 }, () => ({ instant: '2026-11-04T10:00:00Z' })));
  db.close();
});
