import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const migration = readFileSync(join(root, 'migrations/195_staff_account_scope.sql'), 'utf8');

describe('staff account scope migration', () => {
  it('keeps existing staff on the all-accounts default', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE staff_members (id TEXT PRIMARY KEY);
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      INSERT INTO staff_members (id) VALUES ('existing-staff');
    `);
    db.exec(migration);

    expect(db.prepare('SELECT account_scope FROM staff_members WHERE id = ?').get('existing-staff'))
      .toEqual({ account_scope: 'all' });
    expect(() => db.prepare("UPDATE staff_members SET account_scope = 'invalid'").run()).toThrow();
  });
});
