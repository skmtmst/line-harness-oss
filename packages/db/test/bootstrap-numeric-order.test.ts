import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

it('基準の形も1000番以降を数値順に再生し、同番号は名前順にする', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'q03-bootstrap-order-'));
  try {
    cpSync(join(root, 'schema.sql'), join(fixture, 'schema.sql'));
    cpSync(join(root, 'scripts'), join(fixture, 'scripts'), { recursive: true });
    cpSync(join(root, 'migrations'), join(fixture, 'migrations'), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    writeFileSync(join(fixture, 'migrations/999_q03_parent.sql'), 'CREATE TABLE q03_order (id TEXT);\n');
    writeFileSync(join(fixture, 'migrations/1000_a_q03_column.sql'), 'ALTER TABLE q03_order ADD COLUMN label TEXT;\n');
    writeFileSync(join(fixture, 'migrations/1000_b_q03_index.sql'), 'CREATE INDEX q03_order_label ON q03_order(label);\n');
    await execFileAsync(process.execPath, [join(fixture, 'scripts/generate-bootstrap.mjs')]);
    const meta = JSON.parse(readFileSync(join(fixture, 'bootstrap-meta.json'), 'utf8'));
    expect(meta.includedMigrations.filter((name: string) => [
      '999_q03_parent.sql', '1000_a_q03_column.sql', '1000_b_q03_index.sql',
    ].includes(name))).toEqual([
      '999_q03_parent.sql', '1000_a_q03_column.sql', '1000_b_q03_index.sql',
    ]);
    const db = new Database(':memory:');
    try {
      db.exec(readFileSync(join(fixture, 'bootstrap.sql'), 'utf8'));
      expect(db.prepare("PRAGMA table_info('q03_order')").all()).toHaveLength(2);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='q03_order_label'").get()).toBeTruthy();
    } finally { db.close(); }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}, 60_000);
