import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const sql = migration('650_booking_analytics_audiences.sql');
const tables = ['analytics_result_audiences', 'analytics_result_audience_members'];
const opened: Database.Database[] = [];

function before650() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE line_accounts(id TEXT PRIMARY KEY);
    CREATE TABLE friends(id TEXT PRIMARY KEY);
    CREATE TABLE funnels(id TEXT PRIMARY KEY);
    INSERT INTO line_accounts VALUES('a'),('b');
    INSERT INTO friends VALUES('f1'),('f2');
    INSERT INTO funnels VALUES('funnel');
  `);
  db.exec(migration('188_analytics_funnels.sql'));
  db.exec(migration('189_analytics_cross.sql'));
  db.exec(`
    INSERT INTO analytics_funnel_runs
      (id,line_account_id,funnel_id,cohort_from,cohort_to,time_zone,data_cutoff_at,state,result_json,created_at)
      VALUES('funnel-run','a','funnel','2026-10-01','2026-10-15','Asia/Tokyo','2026-10-16','pending','{}','2026-10-16');
    INSERT INTO analytics_cross_runs
      (id,line_account_id,query_json,period_from,period_to,time_zone,data_cutoff_at,created_at)
      VALUES('cross-run','a','{}','2026-10-01','2026-10-15','Asia/Tokyo','2026-10-16','2026-10-16');
    INSERT INTO analytics_result_audiences VALUES
      ('aud1','a','funnel','funnel-run','all',2,'2030-01-01','actor','2026-10-16'),
      ('aud2','a','cross','cross-run','cell',1,'2030-02-01',NULL,'2026-10-15');
    INSERT INTO analytics_result_audience_members VALUES('aud1','f1'),('aud1','f2'),('aud2','f2');
  `);
  return db;
}

function schema(db: Database.Database, table: string) {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[];
  const normalize = (value: unknown) => String(value)
    .replace(/\b(analytics_cross_runs|analytics_funnel_runs)\s+r\b/g, '$1')
    .replace(/\br\./g, '')
    .replace(/["\s]/g, '').toLowerCase();
  return {
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: indexes.map(index => ({
      ...index,
      columns: db.prepare(`PRAGMA index_xinfo(${index.name})`).all(),
    })),
    triggers: db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name`)
      .all(table).map(row => {
        const trigger = row as { name: string; sql: string };
        return { name: trigger.name, sql: normalize(trigger.sql) };
      }),
  };
}

function rows(db: Database.Database) {
  return tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all());
}

function apply(db: Database.Database) {
  db.transaction(() => db.exec(sql))();
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('650: analytics audience rebuild', () => {
  it('preserves every old column, index, trigger, key and recipient from the actual preceding migrations', () => {
    const db = before650();
    const oldRows = rows(db);
    const oldSchemas = tables.map(table => schema(db, table));
    apply(db);
    expect(rows(db)).toEqual(oldRows);
    for (const [i, table] of tables.entries()) {
      const next = schema(db, table);
      expect(next.columns).toEqual(oldSchemas[i].columns);
      expect(next.foreignKeys).toEqual(oldSchemas[i].foreignKeys);
      expect(next.indexes).toEqual(oldSchemas[i].indexes);
      expect(next.triggers).toEqual(expect.arrayContaining(oldSchemas[i].triggers));
      expect(next.triggers).toHaveLength(oldSchemas[i].triggers.length + (i === 0 ? 1 : 0));
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%_new' OR name LIKE '%_next'`).all())
      .toEqual([]);
  });

  it.each(tables)('fails and rolls back when SELECT * has an unexpected column in %s', table => {
    const db = before650();
    db.exec(`ALTER TABLE ${table} ADD COLUMN future_value TEXT DEFAULT 'must survive'`);
    const oldRows = rows(db);
    const oldSchemas = tables.map(name => schema(db, name));
    expect(() => apply(db)).toThrow(/columns? but \d+ values? (?:were|was) supplied/i);
    expect(rows(db)).toEqual(oldRows);
    expect(tables.map(name => schema(db, name))).toEqual(oldSchemas);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%_new'`).all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['funnel', 'cross', 'booking'])('preserves source validation and account isolation for %s', kind => {
    const db = before650();
    apply(db);
    db.exec(`INSERT INTO style_analytics_results VALUES('booking-run','a','salon','{}','2026-10-16','2030-01-01')`);
    const insert = db.prepare(`INSERT INTO analytics_result_audiences
      VALUES(?,?,?,?, 'selection',0,'2030-01-01',NULL,'2026-10-16')`);
    const result = `${kind}-run`;
    expect(() => insert.run('valid', 'a', kind, result)).not.toThrow();
    expect(() => insert.run('missing', 'a', kind, 'missing')).toThrow('analytics_result_source_not_found');
    expect(() => insert.run('other-account', 'b', kind, result)).toThrow('analytics_result_source_not_found');
    expect(() => insert.run('bad-kind', 'a', 'invalid', result)).toThrow(/CHECK/);
  });

  it('preserves uniqueness, foreign keys and cascading removal of recipients', () => {
    const db = before650();
    apply(db);
    const member = db.prepare('INSERT INTO analytics_result_audience_members VALUES(?,?)');
    expect(() => member.run('aud1', 'f1')).toThrow(/UNIQUE/);
    expect(() => member.run('missing', 'f1')).toThrow(/FOREIGN KEY/);
    expect(() => member.run('aud1', 'missing')).toThrow(/FOREIGN KEY/);
    db.exec("DELETE FROM friends WHERE id='f1'");
    expect(db.prepare("SELECT * FROM analytics_result_audience_members WHERE friend_id='f1'").all()).toEqual([]);
    db.exec("DELETE FROM analytics_result_audiences WHERE id='aud2'");
    expect(db.prepare("SELECT * FROM analytics_result_audience_members WHERE audience_id='aud2'").all()).toEqual([]);
    db.exec("DELETE FROM line_accounts WHERE id='a'");
    expect(rows(db)).toEqual([[], []]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
