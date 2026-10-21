import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/steps/database.js';
import { wrangler, WranglerError } from '../src/lib/wrangler.js';

vi.mock('../src/lib/wrangler.js', async (original) => ({
  ...await original<typeof import('../src/lib/wrangler.js')>(),
  wrangler: vi.fn(),
}));
vi.mock('@clack/prompts', () => ({
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { warn: vi.fn() },
}));

const id = '00000000-0000-4000-8000-000000000001';
let repo: string;
let db: DatabaseSync;
let files: string[];
let commands: string[];
let failFile: string | undefined;
let failLedger: boolean;

function writeMeta(names: string[], count = names.length) {
  writeFileSync(join(repo, 'packages/db/bootstrap-meta.json'), JSON.stringify({
    includedMigrations: names, migrationCount: count,
  }));
}

function ledgerNames(): string[] {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE name='_migrations'").get();
  return exists ? db.prepare('SELECT name FROM _migrations ORDER BY name').all().map(row => String(row.name)) : [];
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'q03-database-test-'));
  mkdirSync(join(repo, 'packages/db/migrations'), { recursive: true });
  db = new DatabaseSync(':memory:');
  files = [];
  commands = [];
  failFile = undefined;
  failLedger = false;
  writeFileSync(join(repo, 'packages/db/schema.sql'), 'CREATE TABLE line_accounts (id TEXT);');
  writeFileSync(join(repo, 'packages/db/bootstrap.sql'), 'CREATE TABLE line_accounts (id TEXT, label TEXT);');
  writeFileSync(join(repo, 'packages/db/migrations/001_label.sql'), 'ALTER TABLE line_accounts ADD COLUMN label TEXT;');
  writeFileSync(join(repo, 'packages/db/migrations/002_data.sql'), "INSERT INTO line_accounts VALUES ('one', 'label');");
  writeMeta(['001_label.sql']);
  vi.mocked(wrangler).mockImplementation(async args => {
    if (args[1] === 'create') return `database_id = "${id}"`;
    if (args[1] === 'list') return JSON.stringify([{ name: 'fresh', uuid: id }]);
    const path = args[args.indexOf('--file') + 1];
    const sql = args.includes('--file') ? readFileSync(path, 'utf8') : args[args.indexOf('--command') + 1];
    if (args.includes('--file')) files.push(path);
    commands.push(sql);
    if (path === failFile) throw new WranglerError('apply failed', 'syntax error');
    if (failLedger && /INSERT OR IGNORE INTO _migrations/.test(sql)) throw new WranglerError('ledger failed', 'permission denied');
    if (/^SELECT/.test(sql)) return JSON.stringify(db.prepare(sql).all());
    try { db.exec(sql); } catch (error) {
      throw new WranglerError('SQL failed', error instanceof Error ? error.message : String(error));
    }
    return '';
  });
});

afterEach(() => {
  db.close();
  rmSync(repo, { recursive: true, force: true });
});

describe('新規DBの基準の形と適用記録（外部通信なし）', () => {
  it('実際の基準の形を立ち上げると全履歴が名前どおりに記録される', async () => {
    const realDb = fileURLToPath(new URL('../../db/', import.meta.url));
    rmSync(join(repo, 'packages/db/migrations'), { recursive: true });
    for (const name of ['bootstrap.sql', 'bootstrap-meta.json', 'migrations']) {
      cpSync(join(realDb, name), join(repo, 'packages/db', name), { recursive: true });
    }
    const allNames = readdirSync(join(realDb, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    await createDatabase(repo, 'fresh');
    expect(ledgerNames()).toEqual(allNames);
    expect(commands.filter(sql => /INSERT OR IGNORE INTO _migrations/.test(sql))).toHaveLength(1);
    expect(files.filter(path => path.endsWith('/ledger.sql')).every(path => !existsSync(path))).toBe(true);
  });

  it('bootstrap分と後続の成功分を記録し、次回の未適用を空にする', async () => {
    await expect(createDatabase(repo, 'fresh')).resolves.toEqual({ databaseId: id, databaseName: 'fresh' });
    expect(ledgerNames()).toEqual(['001_label.sql', '002_data.sql']);
    expect(db.prepare('SELECT * FROM line_accounts').all()).toEqual([{ id: 'one', label: 'label' }]);
    expect(files).not.toContain(join(repo, 'packages/db/migrations/001_label.sql'));
    expect(commands.findIndex(sql => /INSERT OR IGNORE INTO _migrations/.test(sql)))
      .toBeLessThan(commands.findIndex(sql => sql.includes("VALUES ('one'")));
  });

  it('本数だけでなく名前ごとに記録し、同番号の別ファイルも残す', async () => {
    writeFileSync(join(repo, 'packages/db/migrations/001_other.sql'), 'CREATE TABLE other (id TEXT);');
    writeFileSync(join(repo, 'packages/db/bootstrap.sql'), 'CREATE TABLE line_accounts (id TEXT, label TEXT); CREATE TABLE other (id TEXT);');
    writeMeta(['001_label.sql', '001_other.sql']);
    await createDatabase(repo, 'fresh');
    expect(ledgerNames()).toEqual(['001_label.sql', '001_other.sql', '002_data.sql']);
  });

  it('1000番以降も番号の数値順で後続を適用する', async () => {
    writeFileSync(join(repo, 'packages/db/migrations/999_parent.sql'), 'CREATE TABLE parent (id TEXT);');
    writeFileSync(join(repo, 'packages/db/migrations/1000_child.sql'), "INSERT INTO parent VALUES ('ok');");
    await createDatabase(repo, 'fresh');
    expect(db.prepare('SELECT * FROM parent').all()).toEqual([{ id: 'ok' }]);
    expect(ledgerNames()).toContain('1000_child.sql');
  });

  it('bootstrap失敗時は含まれる名前も後続も記録しない', async () => {
    failFile = join(repo, 'packages/db/bootstrap.sql');
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('apply failed');
    expect(ledgerNames()).toEqual([]);
    expect(files).not.toContain(join(repo, 'packages/db/migrations/002_data.sql'));
  });

  it('新規bootstrapの重複エラーを成功扱いしない', async () => {
    writeFileSync(join(repo, 'packages/db/bootstrap.sql'), 'CREATE TABLE line_accounts (id TEXT); CREATE TABLE line_accounts (id TEXT);');
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('SQL failed');
    expect(ledgerNames()).toEqual([]);
  });

  it('後続が失敗した名前は記録せず、bootstrap分だけ残す', async () => {
    failFile = join(repo, 'packages/db/migrations/002_data.sql');
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('apply failed');
    expect(ledgerNames()).toEqual(['001_label.sql']);
    expect(db.prepare("SELECT state FROM _musubo_migration_history WHERE name='__lock__'").get()).toEqual({state:'applying'});
  });

  it('記録保存が失敗したら後続へ進まない', async () => {
    failLedger = true;
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('ledger failed');
    expect(files).not.toContain(join(repo, 'packages/db/migrations/002_data.sql'));
    expect(ledgerNames()).toEqual([]);
    expect(files.filter(path => path.endsWith('/ledger.sql')).every(path => !existsSync(path))).toBe(true);
  });

  it('metaなしの導入は過去SQLを再実行せず停止する', async () => {
    rmSync(join(repo, 'packages/db/bootstrap-meta.json'));
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('bootstrap');
    expect(ledgerNames()).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('後続が一部だけ適用されて重複エラーになっても記録しない', async () => {
    writeFileSync(join(repo, 'packages/db/migrations/002_data.sql'),
      'CREATE TABLE line_accounts (id TEXT); CREATE TABLE skipped (id TEXT);');
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('SQL failed');
    expect(ledgerNames()).toEqual(['001_label.sql']);
    expect(db.prepare("SELECT state FROM _musubo_migration_history WHERE name='__lock__'").get()).toEqual({state:'applying'});
  });

  it.each([
    { names: ['001_label.sql'], count: 2 },
    { names: ['001_label.sql', '001_label.sql'], count: 2 },
    { names: ['../escape.sql'], count: 1 },
    { names: ['001_missing.sql'], count: 1 },
  ])('不整合なmetaを適用済みの根拠にしない: $names / $count', async ({ names, count }) => {
    writeMeta(names, count);
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('bootstrap');
    expect(files).not.toContain(join(repo, 'packages/db/bootstrap.sql'));
    expect(ledgerNames()).not.toContain('001_missing.sql');
    expect(ledgerNames()).not.toContain('../escape.sql');
    expect(commands).toEqual([]);
  });

  it('既存DBではbootstrapも適用記録の追記も行わない', async () => {
    const mock = vi.mocked(wrangler).getMockImplementation()!;
    vi.mocked(wrangler).mockImplementation(async args => {
      if (args[1] === 'create') throw new WranglerError('exists', 'already exists');
      return mock(args);
    });
    await expect(createDatabase(repo, 'fresh')).rejects.toThrow('既存D1');
    expect(files).not.toContain(join(repo, 'packages/db/bootstrap.sql'));
    expect(ledgerNames()).toEqual([]);
    expect(commands.some(sql => sql.includes('_migrations'))).toBe(false);
  });
});
