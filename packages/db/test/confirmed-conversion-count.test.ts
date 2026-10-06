import Database from 'better-sqlite3';
import { expect,it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { getConfirmedConversionCount } from '../src/conversion-definitions.js';
it('確定成果は承認・取消・所属・日本時間の期間を同時に守る',async()=>{
 const db=new Database(':memory:');
 try {
  db.exec(`CREATE TABLE conversion_points(id TEXT,line_account_id TEXT); CREATE TABLE friends(id TEXT,line_account_id TEXT);
    CREATE TABLE conversion_events(id TEXT,conversion_point_id TEXT,friend_id TEXT,approval_status TEXT,created_at TEXT);
    CREATE TABLE conversion_event_reversals(conversion_event_id TEXT,kind TEXT,created_at TEXT);
    INSERT INTO conversion_points VALUES ('p','a'),('q','b'); INSERT INTO friends VALUES ('f','a'),('g','b');
    INSERT INTO conversion_events VALUES ('ok','p','f',NULL,'2026-10-03T15:00:00Z'),('restored','p','f','approved','2026-10-04T12:00:00+09:00'),('pending','p','f','pending','2026-10-04'),('rejected','p','f','rejected','2026-10-04'),('rev','p','f',NULL,'2026-10-04'),('other','q','g',NULL,'2026-10-04'),('cross','p','g',NULL,'2026-10-04'),('end','p','f',NULL,'2026-10-04T15:00:00Z');
    INSERT INTO conversion_event_reversals VALUES ('rev','reverse','2026-10-05'),('restored','reverse','2026-10-05'),('restored','restore','2026-10-06');`);
  expect(await getConfirmedConversionCount(asD1(db),{lineAccountId:'a',from:'2026-10-04',to:'2026-10-04'})).toBe(2);
 } finally {db.close();}
});
