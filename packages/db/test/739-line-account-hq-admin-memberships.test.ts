import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(import.meta.dirname, '..', 'migrations', '739_line_account_hq_admin_memberships.sql'), 'utf8');

describe('explicit HQ administrator account memberships', () => {
  it('keeps existing membership explicit when another account is created', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE staff_members(id TEXT PRIMARY KEY); CREATE TABLE line_accounts(id TEXT PRIMARY KEY)');
    db.exec(migration);
    db.exec("INSERT INTO staff_members VALUES ('admin'); INSERT INTO line_accounts VALUES ('current')");
    db.prepare('INSERT INTO line_account_hq_admin_memberships(line_account_id,staff_id) VALUES (?,?)')
      .run('current', 'admin');
    db.exec("INSERT INTO line_accounts VALUES ('later')");
    expect(db.prepare('SELECT line_account_id FROM line_account_hq_admin_memberships').all())
      .toEqual([{ line_account_id: 'current' }]);
    expect(() => db.prepare('INSERT INTO line_account_hq_admin_memberships(line_account_id,staff_id) VALUES (?,?)')
      .run('current', 'admin')).toThrow();
    db.close();
  });
});
