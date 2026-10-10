import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import refs from '../../../apps/worker/src/services/customer-data-protected-relations.json';
import { seedDeletionRecords } from './fixtures/customer-deletion.mjs';
const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('migrations/634_customer_deletion_retained_references.sql', root), 'utf8');
const statements = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
let baseline: Buffer;
it('fits D1 SQL/file limits and contains only the approved rebuilt tables', () => {
  expect(Math.max(...statements.map(s=>Buffer.byteLength(s)))).toBeLessThan(100000);
  expect(Buffer.byteLength(sql)).toBeLessThan(5_000_000_000);
  expect([...sql.matchAll(/DROP TABLE (\w+);/g)].map(m=>m[1]).sort()).toEqual(Object.keys(refs).sort());
  expect(sql).toContain('-- migration-policy: table-rebuild');
});
beforeAll(() => {
  const db = new Database(':memory:');
  try {
    db.exec(readFileSync(new URL('schema.sql', root), 'utf8'));
    for (const file of readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql') && Number(f.split('_')[0]) < 634).sort()) {
      for (const statement of readFileSync(new URL(`migrations/${file}`, root), 'utf8').split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean)) {
        try { db.exec(statement); } catch (e) { if (!/duplicate column name|already exists/i.test(String(e))) throw e; }
      }
    }
    baseline = db.serialize();
  } finally { db.close(); }
}, 120_000);
function fresh() { const db = new Database(baseline); db.pragma('foreign_keys = ON'); return db; }
function apply(db: Database.Database, commands = statements) { db.transaction(() => { for (const statement of commands) db.exec(statement); })(); }
function schema(db: Database.Database) { return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all(); }
function info(db: Database.Database, table: string) { return (db.pragma(`table_info(${table})`) as Array<{cid:number;name:string;notnull:number}>).map(({cid,...c})=>c); }
function indexes(db: Database.Database, table: string) { return (db.pragma(`index_list(${table})`) as Array<{seq:number;name:string}>).map(({seq,...r})=>r).sort((a,b)=>a.name.localeCompare(b.name)); }
function fk(db: Database.Database, table: string) { return db.pragma(`foreign_key_list(${table})`) as Array<{id:number;seq:number;from:string;table:string;to:string;on_update:string;on_delete:string;match:string}>; }
function checks(sql: string) {
  const result:string[]=[];
  for (const match of sql.matchAll(/\bCHECK\s*\(/g)) {
    let depth=1, quoted=false, index=match.index!+match[0].length, start=index;
    for (;index<sql.length && depth;index++) {
      if(sql[index]==="'") { if(quoted && sql[index+1]==="'") { index++; continue; } quoted=!quoted; }
      if(!quoted) { if(sql[index]==='(')depth++; if(sql[index]===')')depth--; }
    }
    result.push(sql.slice(start,index-1).replace(/\s+/g,' ').trim());
  }
  return result;
}
function rows(db: Database.Database, table: string) { return db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all() as Record<string,unknown>[]; }

it.each([0, 1, 2000])('preserves seeds, every row/column/index/trigger/FK and CHECK on %i fixed record sets with FK ON', count => {
  const db = fresh();
  try {
    db.transaction(() => { if (count) seedDeletionRecords(db, 'large', 'fixture-friend', count); })();
    const beforeSchema = schema(db) as Array<{type:string;name:string;tbl_name:string;sql:string}>;
    const before = Object.fromEntries(Object.keys(refs).map(t => [t, { info: info(db,t), fk: fk(db,t), rows: rows(db,t), indexes: indexes(db,t) }]));
    const seeds = rows(db, 'friend_fixed_fields');
    const started = performance.now(); apply(db); const ms = performance.now() - started;
    console.log(`migration 634: ${count} fixture sets; ${Object.keys(refs).reduce((n,t)=>n+before[t].rows.length,0)} retained rows; ${Math.round(ms)}ms; max SQL ${Math.max(...statements.map(s=>Buffer.byteLength(s)))} bytes`);
    expect(db.pragma('foreign_keys', {simple:true})).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(rows(db,'friend_fixed_fields')).toEqual(seeds);
    for (const [table, relationships] of Object.entries(refs)) {
      const cols = relationships.flatMap(r=>r.columns.map(c=>c.column));
      expect(info(db,table).filter(c=>!c.name.endsWith('_history'))).toEqual(before[table].info.map(c=>cols.includes(c.name)?{...c,notnull:0}:c));
      // IDs/order of pragma rows are immaterial; compare the relationship itself.
      const normalize = (list: ReturnType<typeof fk>) => list.map(({id,seq,...r})=>r).sort((a,b)=>a.from.localeCompare(b.from));
      expect(normalize(fk(db,table))).toEqual(normalize(before[table].fk.map(r=>cols.includes(r.from)?{...r,on_delete:'SET NULL'}:r)));
      expect(indexes(db,table)).toEqual(before[table].indexes);
      const oldChecks=checks(beforeSchema.find(o=>o.type==='table' && o.name===table)!.sql);
      const newChecks=checks((schema(db) as typeof beforeSchema).find(o=>o.type==='table' && o.name===table)!.sql);
      if(table==='affiliate_settlement_lines') {
        expect(newChecks.slice(0,-1)).toEqual(oldChecks.slice(0,-1));
        expect(newChecks.at(-1)).toContain('COALESCE(entry_id, entry_id_history)');
      } else expect(newChecks).toEqual(oldChecks);
      expect(fk(db,table).some(f=>f.from.endsWith('_history'))).toBe(false);

      expect(rows(db,table).map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>!k.endsWith('_history'))))).toEqual(before[table].rows);
      for (const row of rows(db,table)) for (const c of cols) expect(row[c+'_history']).toBe(row[c]);
    }
    // Exact existing index/trigger SQL and untouched tables; the only new objects are history triggers.
    const afterSchema = schema(db) as typeof beforeSchema;
    for (const obj of beforeSchema.filter(o=>o.type!=='table' || !(o.name in refs))) expect(afterSchema).toContainEqual(obj);
    if (count) expect(() => db.exec("UPDATE booking_payments SET amount=-1")).toThrow(/CHECK/);
  } finally { db.close(); }
}, 120_000);

it('rolls back every schema/data change on failure after an earlier table was replaced, then retries', () => {
  const db = fresh();
  try {
    seedDeletionRecords(db);
    const beforeSchema=schema(db), before=Object.fromEntries(Object.keys(refs).map(t=>[t,rows(db,t)]));
    const cut=statements.findIndex(s=>s.includes('ALTER TABLE booking_payments_new RENAME TO'))+1;
    expect(()=>apply(db,[...statements.slice(0,cut),'SELECT json(\'intentional failure\')',...statements.slice(cut)])).toThrow(/malformed JSON/);
    expect(schema(db)).toEqual(beforeSchema);
    for(const t of Object.keys(refs)) expect(rows(db,t)).toEqual(before[t]);
    apply(db); expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { db.close(); }
});

it('refuses out-of-range rowids atomically rather than silently losing rows', () => {
  const db=fresh(); try {
    seedDeletionRecords(db); db.exec('UPDATE booking_payments SET rowid=100001');
    const before=schema(db);
    expect(()=>apply(db)).toThrow(/malformed JSON/);
    expect(schema(db)).toEqual(before);
    expect(rows(db,'booking_payments')).toHaveLength(1);
  } finally { db.close(); }
});

it('keeps all 15 internal IDs on deletion, preserves amounts and rejects an invalid double source', () => {
  const db=fresh(); try {
    seedDeletionRecords(db); apply(db);
    const before=Object.fromEntries(Object.keys(refs).map(t=>[t,rows(db,t)]));
    db.transaction(()=>{
      db.pragma('defer_foreign_keys = ON');
      db.exec('DELETE FROM bookings; DELETE FROM mileage_adjustment_approval_requests; DELETE FROM nen_photo_submissions; DELETE FROM affiliate_adjustments; DELETE FROM affiliate_reward_entries; DELETE FROM affiliate_bank_profiles; DELETE FROM affiliates; DELETE FROM conversion_events;');
    })();
    expect(db.pragma('foreign_key_check')).toEqual([]);
    for(const [table,relationships] of Object.entries(refs)) {
      expect(rows(db,table)).toHaveLength(before[table].length);
      for(let i=0;i<before[table].length;i++) for(const c of relationships.flatMap(r=>r.columns.map(c=>c.column))) {
        expect(rows(db,table)[i][c]).toBeNull(); expect(rows(db,table)[i][c+'_history']).toBe(before[table][i][c]);
      }
    }
    expect(()=>db.exec("UPDATE affiliate_settlement_lines SET adjustment_id_history='bad' WHERE entry_id_history IS NOT NULL")).toThrow(/CHECK/);
  } finally { db.close(); }
});

it('captures IDs for new post-migration records and preserves unrelated CHECK constraints', () => {
  const db=fresh(); try {
    apply(db); seedDeletionRecords(db,'new');
    for(const [table,relationships] of Object.entries(refs)) for(const row of rows(db,table)) {
      for(const column of relationships.flatMap(r=>r.columns.map(c=>c.column))) expect(row[column+'_history']).toBe(row[column]);
    }
    expect(()=>db.exec("UPDATE affiliate_settlement_lines SET entry_id=NULL, entry_id_history=NULL WHERE entry_id IS NOT NULL")).toThrow(/CHECK/);
    expect(()=>db.exec("UPDATE nen_photo_risk_assessments SET confidence=2")).toThrow(/CHECK/);
    expect(()=>db.exec("UPDATE nen_photo_assessment_runs SET requested_version=0")).toThrow(/CHECK/);
    expect(()=>db.exec("UPDATE affiliate_payout_results SET result='bad'")).toThrow(/CHECK/);
  } finally { db.close(); }
});
