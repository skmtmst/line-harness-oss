import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyTrackedMigrations, migrationBaselineSql } from '../src/migration-history.js';
let db: Database.Database;
let lostResponse = false;
const creds = { accountId: 'fixture', apiToken: 'fixture' };
const old = new Map([['063_old.sql', Buffer.from('DELETE FROM keep_data;')]]);
beforeEach(() => {
  lostResponse = false; db = new Database(':memory:');
  db.exec("CREATE TABLE keep_data(id TEXT); INSERT INTO keep_data VALUES('keep');");
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const { sql, params } = JSON.parse(String(options.body));
    const statement = db.prepare(sql);
    const results = statement.reader ? statement.all(...params) : [];
    if (!statement.reader) statement.run(...params);
    if (lostResponse && sql.startsWith('CREATE TABLE new_data')) throw new Error('response_lost');
    return Response.json({ success: true, result: [{ success: true, results }] });
  }));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });
const options = (files = old) => ({ creds, databaseId: 'fixture', names: [...files.keys()], files });
test('履歴もchecksumも一致した過去SQLは再実行せず、新規だけを一度適用する', async () => {
  db.exec(migrationBaselineSql(old, 'reviewed-source-fixture'));
  const files = new Map([...old, ['700_new.sql', Buffer.from('CREATE TABLE new_data(id TEXT);')] as [string, Buffer]]);
  await applyTrackedMigrations(options(files)); await applyTrackedMigrations(options(files));
  expect(db.prepare('SELECT * FROM keep_data').all()).toEqual([{ id: 'keep' }]);
  expect(db.prepare('SELECT name FROM _migrations ORDER BY name').all()).toEqual([{name:'063_old.sql'},{name:'700_new.sql'}]);
  expect(db.prepare("SELECT state FROM _musubo_migration_history WHERE name='__lock__'").get()).toEqual({state:'ready'});
});
test('旧台帳の名前だけでは適用済みと推測せず、新規SQLより前に止める', async () => {
  db.exec("CREATE TABLE _migrations(name TEXT); INSERT INTO _migrations VALUES('063_old.sql');");
  await expect(applyTrackedMigrations(options())).rejects.toThrow('migration_baseline_required');
  expect(db.prepare('SELECT * FROM keep_data').all()).toHaveLength(1);
});
test('checksum不一致はSQLを実行する前に停止する', async () => {
  db.exec(migrationBaselineSql(old, 'reviewed'));
  await expect(applyTrackedMigrations(options(new Map([['063_old.sql', Buffer.from('DELETE FROM keep_data WHERE 1=1;')]])))).rejects.toThrow('migration_checksum_mismatch');
  expect(db.prepare('SELECT * FROM keep_data').all()).toHaveLength(1);
});
test('成功応答を失った実行は自動再実行しない', async () => {
  db.exec(migrationBaselineSql(old, 'reviewed')); lostResponse = true;
  const files = new Map([['700_new.sql', Buffer.from('CREATE TABLE new_data(id TEXT);')]]);
  await expect(applyTrackedMigrations(options(files))).rejects.toThrow('response_lost');
  lostResponse = false;
  await expect(applyTrackedMigrations(options(files))).rejects.toThrow('migration_recovery_required');
  expect(db.prepare("SELECT state FROM _musubo_migration_history WHERE name='700_new.sql'").get()).toEqual({state:'applying'});
});
test('並行更新が同じ新規SQLを二度実行しない', async () => {
  db.exec(migrationBaselineSql(old, 'reviewed'));
  const files = new Map([['700_new.sql', Buffer.from('CREATE TABLE new_data(id TEXT);')]]);
  const result = await Promise.allSettled([applyTrackedMigrations(options(files)),applyTrackedMigrations(options(files))]);
  expect(result.some(row=>row.status==='fulfilled')).toBe(true);
  expect(db.prepare("SELECT state FROM _musubo_migration_history WHERE name='700_new.sql'").get()).toEqual({state:'applied'});
  expect(vi.mocked(fetch).mock.calls.filter(([,init])=>JSON.parse(String(init!.body)).sql.startsWith('CREATE TABLE new_data'))).toHaveLength(1);
});
test('baselineを既存の履歴へ重ねて上書きしない', () => {
  db.exec(migrationBaselineSql(old, 'reviewed'));
  expect(()=>db.exec(migrationBaselineSql(old,'second'))).toThrow('already exists');
});
