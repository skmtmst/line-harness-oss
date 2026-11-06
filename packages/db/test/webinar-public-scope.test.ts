import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { getWebinarBySlug } from '../src/webinars/index.js';
const opened: Database.Database[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); });
function fixture() {
  const raw = new Database(':memory:'); opened.push(raw);
  raw.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE line_accounts(id TEXT PRIMARY KEY,tenant_id TEXT,is_active INTEGER,archived_at TEXT);
    CREATE TABLE webinars(id TEXT PRIMARY KEY,slug TEXT,account_id TEXT,title TEXT,status TEXT);
    INSERT INTO tenants VALUES('live','active'),('paused','suspended');
    INSERT INTO line_accounts VALUES('a','live',1,NULL),('b','paused',1,NULL),('c','live',0,NULL),('d','live',1,'2026-10-16');
    INSERT INTO webinars VALUES('wa','live','a','Fixture live','active'),('wb','paused','b','Fixture paused','active'),
      ('wc','inactive','c','Fixture inactive','active'),('wd','archived','d','Fixture archived','active'),
      ('wl','legacy',NULL,'Fixture legacy','active');`);
  const db = { prepare(sql: string) { return { bind(...args: unknown[]) { return { async first() { return raw.prepare(sql).get(...args) ?? null; } }; } }; } } as unknown as D1Database;
  return { db, raw };
}
describe('S15 public webinar and signed video lookup', () => {
  it('closes suspended, inactive, archived and missing owners while retaining active and legacy rows', async () => {
    const { db, raw } = fixture();
    for (const slug of ['paused','inactive','archived']) expect(await getWebinarBySlug(db, slug, { activeAccountOnly: true })).toBeNull();
    expect((await getWebinarBySlug(db, 'live', { activeAccountOnly: true }))?.id).toBe('wa');
    expect((await getWebinarBySlug(db, 'legacy', { activeAccountOnly: true }))?.id).toBe('wl');
    expect((await getWebinarBySlug(db, 'paused'))?.id).toBe('wb'); // Admin management can still find it.
    raw.prepare("DELETE FROM line_accounts WHERE id='a'").run();
    expect(await getWebinarBySlug(db, 'live', { activeAccountOnly: true })).toBeNull();
  });
});
