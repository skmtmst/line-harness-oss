import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const columns = ['legal_company_name', 'company_postal_code', 'company_address', 'company_building',
  'company_phone', 'contact_name', 'contact_email', 'invoice_addressee'];

it('614の実SQLは既存の統括を残し、NULL可TEXTの8欄だけを足す', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY, name TEXT); INSERT INTO tenants VALUES('existing','既存の統括')");
    const schemaBefore = db.prepare('SELECT rootpage FROM sqlite_master WHERE name=?').get('tenants');
    db.exec(readFileSync(new URL('../migrations/614_tenant_company_contact.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT rootpage FROM sqlite_master WHERE name=?').get('tenants')).toEqual(schemaBefore);
    expect(db.prepare('SELECT * FROM tenants').get()).toEqual({ id: 'existing', name: '既存の統括',
      ...Object.fromEntries(columns.map(column => [column, null])) });
    const info = db.prepare('PRAGMA table_info(tenants)').all() as Array<{name: string; type: string; notnull: number; dflt_value: unknown}>;
    expect(info.slice(2).map(({name,type,notnull,dflt_value}) => ({name,type,notnull,dflt_value})))
      .toEqual(columns.map(name => ({name,type:'TEXT',notnull:0,dflt_value:null})));
    for (const column of columns) {
      db.prepare(`UPDATE tenants SET ${column}=? WHERE id='existing'`).run(`保存した${column}`);
      expect((db.prepare(`SELECT ${column} FROM tenants`).get() as Record<string, unknown>)[column]).toBe(`保存した${column}`);
      db.prepare(`UPDATE tenants SET ${column}=NULL WHERE id='existing'`).run();
    }
  } finally { db.close(); }
});
