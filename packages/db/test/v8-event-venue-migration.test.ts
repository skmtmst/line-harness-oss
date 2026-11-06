import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('576は既存の会場を保ち、住所を追加する', () => {
 const db = new Database(':memory:');
 try {
  db.exec("CREATE TABLE events (id TEXT PRIMARY KEY, venue_name TEXT, venue_url TEXT); INSERT INTO events VALUES ('e','会場','https://example.com')");
  db.exec(readFileSync(new URL('../migrations/576_v8_event_venue_address.sql', import.meta.url), 'utf8'));
  expect(db.prepare('SELECT * FROM events').get()).toEqual({id:'e',venue_name:'会場',venue_url:'https://example.com',venue_address:null});
  db.prepare('UPDATE events SET venue_address=? WHERE id=?').run('テスト住所','e');
  expect(db.prepare('SELECT venue_address FROM events').get()).toEqual({venue_address:'テスト住所'});
 } finally { db.close(); }
});
