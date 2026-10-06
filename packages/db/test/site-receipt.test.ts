import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { recordMeasurementSiteReceipt } from '../src/web-measurement.js';
it('577の受信時刻はサイト・所属・停止を守り、古い時刻で戻らない', async () => {
 const db = new Database(':memory:');
 try {
  db.exec("CREATE TABLE measurement_sites(id TEXT, line_account_id TEXT, stopped_at TEXT); INSERT INTO measurement_sites VALUES ('s','a',NULL),('other','b',NULL),('stopped','a','2026-09-01')");
  db.exec(readFileSync(new URL('../migrations/577_v8_site_receipt.sql', import.meta.url), 'utf8'));
  for (const [id, at] of [['s','2026-10-04T21:00:00+09:00'],['s','2026-10-04T10:00:00Z'],['other','2026-10-04T21:00:00+09:00'],['stopped','2026-10-04T21:00:00+09:00']]) await recordMeasurementSiteReceipt(asD1(db), id, 'a', at);
  expect(db.prepare('SELECT id,last_received_at FROM measurement_sites ORDER BY id').all()).toEqual([{id:'other',last_received_at:null},{id:'s',last_received_at:'2026-10-04T21:00:00+09:00'},{id:'stopped',last_received_at:null}]);
 } finally { db.close(); }
});
