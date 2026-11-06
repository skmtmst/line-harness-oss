import Database from 'better-sqlite3';
import { it, expect } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { getFriendActiveMonthComparison } from '../src/dashboard.js';
it('前月末の可視アカウントが揃うときだけ比較し、他者と旧全体行を除く', async () => {
 const raw = new Database(':memory:');
 try {
  raw.exec("CREATE TABLE friend_daily_snapshots (date TEXT, line_account_id TEXT, active INTEGER); INSERT INTO friend_daily_snapshots VALUES ('2026-09-30','a',5),('2026-09-30','b',99),('2026-09-30','',999)");
  const db = asD1(raw), now = Date.parse('2026-09-30T15:00:00Z');
  expect(await getFriendActiveMonthComparison(db, { allowedAccountIds:['a'], includeUnassigned:false }, 7, now)).toEqual({ activeLastMonth:5, activeMonthDelta:2, activeComparisonDate:'2026-09-30' });
  expect(await getFriendActiveMonthComparison(db, { allowedAccountIds:['a','c'], includeUnassigned:false }, 7, now)).toMatchObject({ activeLastMonth:null, activeMonthDelta:null });
  raw.exec("UPDATE friend_daily_snapshots SET active = 0 WHERE line_account_id = 'a'");
  expect(await getFriendActiveMonthComparison(db, { allowedAccountIds:['a'], includeUnassigned:false }, 7, now)).toMatchObject({ activeLastMonth:0, activeMonthDelta:7 });
 } finally { raw.close(); }
});
